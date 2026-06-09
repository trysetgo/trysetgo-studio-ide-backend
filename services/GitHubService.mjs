import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

export class GitHubService {
  async getStatus(connection, token = config.githubToken) {
    const authToken = requireGitHubToken(token);
    const repo = await this.request(
      `/repos/${connection.owner}/${connection.repository}`,
      { token: authToken }
    );
    const branch = await this.request(
      `/repos/${connection.owner}/${connection.repository}/branches/${connection.default_branch}`,
      { token: authToken }
    );

    return {
      provider: "github",
      owner: connection.owner,
      repository: connection.repository,
      branch: connection.default_branch,
      latestCommitSha: branch.commit?.sha ?? null,
      latestCommitUrl: branch.commit?.url ?? null,
      private: Boolean(repo.private),
      syncStatus: "connected"
    };
  }

  async commitFiles({ connection, files, message, token = config.githubToken }) {
    const authToken = requireGitHubToken(token);
    const basePath = `/repos/${connection.owner}/${connection.repository}`;
    const branch = await this.request(
      `${basePath}/git/ref/heads/${connection.default_branch}`,
      { token: authToken }
    );
    const latestCommitSha = branch.object?.sha;
    const latestCommit = await this.request(
      `${basePath}/git/commits/${latestCommitSha}`,
      { token: authToken }
    );

    const tree = await this.request(`${basePath}/git/trees`, {
      method: "POST",
      token: authToken,
      body: {
        base_tree: latestCommit.tree?.sha,
        tree: files.map((file) => ({
          path: file.path,
          mode: "100644",
          type: "blob",
          content: file.content
        }))
      }
    });

    const commit = await this.request(`${basePath}/git/commits`, {
      method: "POST",
      token: authToken,
      body: {
        message,
        tree: tree.sha,
        parents: [latestCommitSha]
      }
    });

    await this.request(`${basePath}/git/refs/heads/${connection.default_branch}`, {
      method: "PATCH",
      token: authToken,
      body: {
        sha: commit.sha,
        force: false
      }
    });

    return {
      sha: commit.sha,
      message,
      branch: connection.default_branch,
      committedFiles: files.length,
      url: commit.html_url ?? null
    };
  }

  async listFiles(connection, token = config.githubToken) {
    const authToken = requireGitHubToken(token);
    const basePath = `/repos/${connection.owner}/${connection.repository}`;
    const branch = await this.request(
      `${basePath}/git/ref/heads/${connection.default_branch}`,
      { token: authToken }
    );
    const commit = await this.request(`${basePath}/git/commits/${branch.object?.sha}`, {
      token: authToken
    });
    const tree = await this.request(
      `${basePath}/git/trees/${commit.tree?.sha}?recursive=1`,
      { token: authToken }
    );

    return (tree.tree ?? []).filter((item) => item.type === "blob");
  }

  async request(path, { body, method = "GET", token }) {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }

    return response.json();
  }
}

function requireGitHubToken(token) {
  if (!token) {
    throw new HttpError(400, "GitHub token is required. Configure GITHUB_TOKEN on the backend.");
  }

  return token;
}

export const gitHubService = new GitHubService();
