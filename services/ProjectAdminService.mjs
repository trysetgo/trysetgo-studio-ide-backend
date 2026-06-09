import { gitRepository } from "../repositories/gitRepository.mjs";
import { activityRepository } from "../repositories/activityRepository.mjs";
import { organizationMemberRepository } from "../repositories/organizationMemberRepository.mjs";
import { projectAdminRepository } from "../repositories/projectAdminRepository.mjs";
import { rbacRepository } from "../repositories/rbacRepository.mjs";
import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";
import { HttpError } from "../utils/http.mjs";

const adminRoles = new Set(["Super Admin", "Owner", "Admin"]);
const allowedProjectRoles = new Set(["Owner", "Admin", "Developer", "Viewer", "AI Agent"]);

export class ProjectAdminService {
  async requireProjectAdmin(context, projectId) {
    if (!context.roles.some((role) => adminRoles.has(role))) {
      await rbacRepository.recordAuditEvent({
        action: "Denied:Project.Admin",
        projectId,
        user: context.user
      });
      throw new HttpError(403, "Super Admin, Owner, or Admin role is required.");
    }
  }

  async overview(projectId) {
    const project = await supabaseProjectRepository.getProject(projectId);
    if (!project) {
      throw new HttpError(404, "Project could not be found.");
    }

    const [members, gitConnection, credentials, auditLogs] = await Promise.all([
      projectAdminRepository.listMembers(projectId),
      gitRepository.getConnection(projectId).catch(() => null),
      projectAdminRepository.listCredentials(project.organization_id).catch(() => []),
      projectAdminRepository.listAuditLogs(projectId)
    ]);

    return { project, members, gitConnection, credentials, auditLogs };
  }

  async inviteMember({ body, projectId, user }) {
    const role = normalizeRole(body.role);
    const userEmail = requireEmail(body.email);
    const project = await supabaseProjectRepository.getProject(projectId);
    if (!project) {
      throw new HttpError(404, "Project could not be found.");
    }
    const authUser = await projectAdminRepository.findAuthUserByEmail(userEmail);
    await organizationMemberRepository.upsertMember({
      organizationId: project.organization_id,
      role: role === "Owner" || role === "Admin" ? role : "Member",
      userEmail,
      userId:
        typeof body.userId === "string"
          ? body.userId
          : authUser?.id
    });
    const member = await projectAdminRepository.upsertMember({
      projectId,
      role,
      userEmail,
      userId:
        typeof body.userId === "string"
          ? body.userId
          : authUser?.id
    });

    await rbacRepository.recordAuditEvent({
      action: "Project.UserInvited",
      projectId,
      user,
      metadata: {
        email: member.user_email,
        role,
        matchedExistingAuthUser: Boolean(authUser)
      }
    });
    await rbacRepository.recordAuditEvent({
      action: "Organization.MemberAdded",
      projectId,
      user,
      metadata: {
        organizationId: project.organization_id,
        email: userEmail,
        role
      }
    });
    await activityRepository.record({
      action: "User Invited",
      entityId: member.id,
      entityType: "project_member",
      metadata: { email: member.user_email, role },
      projectId,
      user
    });

    return member;
  }

  async changeRole({ body, memberId, projectId, user }) {
    const role = normalizeRole(body.role);
    const project = await supabaseProjectRepository.getProject(projectId);
    const member = await projectAdminRepository.updateMemberRole(projectId, memberId, role);
    if (project) {
      await organizationMemberRepository.upsertMember({
        organizationId: project.organization_id,
        role: role === "Owner" || role === "Admin" ? role : "Member",
        userEmail: member.user_email,
        userId: member.user_id
      });
    }

    await rbacRepository.recordAuditEvent({
      action: "Project.RoleChanged",
      projectId,
      user,
      metadata: { memberId, role }
    });
    await activityRepository.record({
      action: "Role Changed",
      entityId: memberId,
      entityType: "project_member",
      metadata: { role },
      projectId,
      user
    });

    return member;
  }

  async removeMember({ memberId, projectId, user }) {
    await projectAdminRepository.removeMember(projectId, memberId);
    await rbacRepository.recordAuditEvent({
      action: "Project.MemberRemoved",
      projectId,
      user,
      metadata: { memberId }
    });
    await activityRepository.record({
      action: "Member Removed",
      entityId: memberId,
      entityType: "project_member",
      projectId,
      user
    });
  }

  async createCredential({ body, projectId, user }) {
    const project = await supabaseProjectRepository.getProject(projectId);
    if (!project) {
      throw new HttpError(404, "Project could not be found.");
    }

    const credential = await projectAdminRepository.createCredential({
      createdBy: user.id,
      organizationId: project.organization_id,
      provider: normalizeProvider(body.provider),
      name: requireText(body.name, "Credential name"),
      secret: requireText(body.secret, "Credential secret")
    });

    await rbacRepository.recordAuditEvent({
      action: "Project.GitCredentialCreated",
      projectId,
      user,
      metadata: { credentialId: credential.id, provider: credential.provider }
    });

    return credential;
  }

  async connectGit({ body, projectId, user }) {
    const connection = await gitRepository.upsertConnection({
      project_id: projectId,
      provider: normalizeProvider(body.provider),
      owner: requireText(body.owner, "Repository owner"),
      repository: requireText(body.repository, "Repository name"),
      default_branch: body.defaultBranch || body.default_branch || "main",
      credential_id: requireText(body.credentialId, "Credential"),
      created_by: user.id
    });

    await rbacRepository.recordAuditEvent({
      action: "Project.GitConnected",
      projectId,
      user,
      metadata: connection
    });
    await activityRepository.record({
      action: "Git Connected",
      entityId: connection.id,
      entityType: "git_connection",
      metadata: { provider: connection.provider, repository: connection.repository },
      projectId,
      user
    });

    return connection;
  }

  async disconnectGit({ projectId, user }) {
    await gitRepository.deleteConnection(projectId);
    await rbacRepository.recordAuditEvent({
      action: "Project.GitDisconnected",
      projectId,
      user
    });
    await activityRepository.record({
      action: "Git Disconnected",
      entityType: "git_connection",
      projectId,
      user
    });
  }
}

function normalizeRole(role) {
  const normalized = requireText(role, "Role");
  if (!allowedProjectRoles.has(normalized)) {
    throw new HttpError(400, "Unsupported project role.");
  }

  return normalized;
}

function normalizeProvider(provider) {
  const normalized = String(provider ?? "github").toLowerCase();
  if (!["github", "gitlab", "bitbucket"].includes(normalized)) {
    throw new HttpError(400, "Unsupported Git provider.");
  }

  return normalized;
}

function requireEmail(value) {
  const email = requireText(value, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Valid email is required.");
  }

  return email;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${label} is required.`);
  }

  return value.trim();
}

export const projectAdminService = new ProjectAdminService();
