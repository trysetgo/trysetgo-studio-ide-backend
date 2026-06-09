import { gcsStorageRepository } from "../repositories/gcsStorageRepository.mjs";
import { gitRepository } from "../repositories/gitRepository.mjs";
import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";
import { rbacRepository } from "../repositories/rbacRepository.mjs";
import { gitHubService } from "./GitHubService.mjs";
import { HttpError } from "../utils/http.mjs";

export class GitService {
  async connect({ body, user }) {
    const projectId = requireStringValue(body.projectId, "Project id");
    const connection = await gitRepository.upsertConnection({
      project_id: projectId,
      provider: normalizeProvider(body.provider),
      owner: requireStringValue(body.owner, "Repository owner"),
      repository: requireStringValue(body.repository, "Repository name"),
      default_branch: body.defaultBranch || body.default_branch || "main",
      created_by: user.id
    });

    await rbacRepository.recordAuditEvent({
      action: "Git.ConnectRepo",
      projectId,
      user,
      metadata: connection
    });

    return connection;
  }

  async status(projectId) {
    const connection = await requireConnection(projectId);
    if (connection.provider !== "github") {
      throw new HttpError(400, `Unsupported Git provider: ${connection.provider}`);
    }

    return gitHubService.getStatus(connection);
  }

  async commit({ body, user }) {
    const projectId = requireStringValue(body.projectId, "Project id");
    const connection = await requireConnection(projectId);
    const project = await supabaseProjectRepository.getProject(projectId);
    if (!project) {
      throw new HttpError(404, "Project could not be found.");
    }

    const files = (await gcsStorageRepository.listFiles(project.storage_path))
      .filter((file) => !file.path.startsWith("versions/"))
      .filter((file) => file.path.endsWith(".txl") || file.path.endsWith(".txlrules"));
    const message = body.message || generateCommitMessage(files);
    const result = await this.provider(connection).commitFiles({
      connection,
      files,
      message
    });

    await rbacRepository.recordAuditEvent({
      action: "Git.Commit",
      projectId,
      user,
      metadata: result
    });

    return result;
  }

  async push({ body, user }) {
    const projectId = requireStringValue(body.projectId, "Project id");
    const status = await this.status(projectId);
    await rbacRepository.recordAuditEvent({
      action: "Git.Push",
      projectId,
      user,
      metadata: status
    });

    return {
      ...status,
      syncStatus: "pushed"
    };
  }

  async pull({ body, user }) {
    const projectId = requireStringValue(body.projectId, "Project id");
    const connection = await requireConnection(projectId);
    const files = await this.provider(connection).listFiles(connection);

    await rbacRepository.recordAuditEvent({
      action: "Git.Pull",
      projectId,
      user,
      metadata: {
        provider: connection.provider,
        branch: connection.default_branch,
        files: files.length
      }
    });

    return {
      provider: connection.provider,
      branch: connection.default_branch,
      files: files.length,
      syncStatus: "pulled"
    };
  }

  provider(connection) {
    if (connection.provider === "github") {
      return gitHubService;
    }

    throw new HttpError(400, `Unsupported Git provider: ${connection.provider}`);
  }
}

async function requireConnection(projectId) {
  const connection = await gitRepository.getConnection(projectId);
  if (!connection) {
    throw new HttpError(404, "Git repository is not connected.");
  }

  return connection;
}

function normalizeProvider(provider) {
  const normalized = String(provider ?? "github").toLowerCase();
  if (!["github", "gitlab", "bitbucket"].includes(normalized)) {
    throw new HttpError(400, "Unsupported Git provider.");
  }

  return normalized;
}

function requireStringValue(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${label} is required.`);
  }

  return value.trim();
}

function generateCommitMessage(files) {
  return `Update TXL workspace (${files.length} files)`;
}

export const gitService = new GitService();
