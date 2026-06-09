import http from "node:http";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";
import { gcsStorageRepository } from "./repositories/gcsStorageRepository.mjs";
import { supabaseProjectRepository } from "./repositories/supabaseProjectRepository.mjs";
import { aiArchitectService } from "./services/AIArchitectService.mjs";
import { aiWorkspaceAgentPlannerService } from "./services/AIWorkspaceAgentPlannerService.mjs";
import { authService } from "./services/authService.mjs";
import { deploymentService } from "./services/DeploymentService.mjs";
import { environmentPromotionService } from "./services/EnvironmentPromotionService.mjs";
import { gitService } from "./services/GitService.mjs";
import { monitoringService } from "./services/MonitoringService.mjs";
import { projectAdminService } from "./services/ProjectAdminService.mjs";
import { projectDeletionService } from "./services/ProjectDeletionService.mjs";
import { activityRepository } from "./repositories/activityRepository.mjs";
import { commentRepository } from "./repositories/commentRepository.mjs";
import { presenceRepository } from "./repositories/presenceRepository.mjs";
import { packageRepository } from "./repositories/packageRepository.mjs";
import { projectAdminRepository } from "./repositories/projectAdminRepository.mjs";
import { rbacRepository } from "./repositories/rbacRepository.mjs";
import { getAuthContext, getProjectAwareAuthContext, requireAnyPermission, requirePermission } from "./auth/authContext.mjs";
import {
  HttpError,
  applyCors,
  readJsonBody,
  requireString,
  sendJson,
  sendNoContent
} from "./utils/http.mjs";

const server = http.createServer(async (request, response) => {
  applyCors(request, response, config.allowedOrigins);

  if (request.method === "OPTIONS") {
    sendNoContent(response);
    return;
  }

  try {
    await routeRequest(request, response);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Unexpected backend error.";
    sendJson(response, status, { error: message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`TrySetGo API listening on ${config.host}:${config.port}/api`);
});

async function routeRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      supabase: supabaseProjectRepository.isConfigured() ? "remote" : "local",
      storage: gcsStorageRepository.isConfigured() ? "gcs" : "local"
    });
    return;
  }

  if (!pathname.startsWith("/api/")) {
    throw new HttpError(404, "Route could not be found.");
  }

  if (pathname === "/api/auth/login" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      await authService.loginWithPassword({
        email: requireString(body.email, "Email"),
        password: requireString(body.password, "Password")
      })
    );
    return;
  }

  if (pathname === "/api/auth/magic-link" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      await authService.sendMagicLink({
        email: requireString(body.email, "Email"),
        redirectTo: typeof body.redirectTo === "string" ? body.redirectTo : undefined
      })
    );
    return;
  }

  if (pathname === "/api/auth/me" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    const context = projectId
      ? await getProjectAwareAuthContext(request, projectId)
      : await getAuthContext(request);
    sendJson(response, 200, {
      user: context.user,
      roles: context.roles,
      permissions: context.permissions
    });
    return;
  }

  if (pathname === "/api/git/connect" && request.method === "POST") {
    const context = await requirePermission(request, "Project.Write");
    const body = await readJsonBody(request);
    sendJson(response, 201, await gitService.connect({ body, user: context.user }));
    return;
  }

  if (pathname === "/api/git/commit" && request.method === "POST") {
    const context = await requirePermission(request, "Project.Write");
    const body = await readJsonBody(request);
    sendJson(response, 200, await gitService.commit({ body, user: context.user }));
    return;
  }

  if (pathname === "/api/git/push" && request.method === "POST") {
    const context = await requirePermission(request, "Project.Write");
    const body = await readJsonBody(request);
    sendJson(response, 200, await gitService.push({ body, user: context.user }));
    return;
  }

  if (pathname === "/api/git/pull" && request.method === "POST") {
    const context = await requirePermission(request, "Project.Write");
    const body = await readJsonBody(request);
    sendJson(response, 200, await gitService.pull({ body, user: context.user }));
    return;
  }

  if (pathname === "/api/git/status" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      throw new HttpError(400, "projectId is required.");
    }
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await gitService.status(projectId));
    return;
  }

  if (pathname === "/api/deployments" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      throw new HttpError(400, "projectId is required.");
    }
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await deploymentService.list(projectId));
    return;
  }

  if (pathname === "/api/deployments/deploy" && request.method === "POST") {
    const body = await readJsonBody(request, 5 * 1024 * 1024);
    const projectId = requireString(body.projectId ?? body.plan?.projectId, "Project id");
    const context = await requirePermission(request, "Deploy.Publish", { projectId });
    sendJson(response, 201, await deploymentService.deploy({ body, user: context.user }));
    return;
  }

  const deploymentStatusMatch = pathname.match(/^\/api\/deployments\/([^/]+)$/);
  if (deploymentStatusMatch && request.method === "GET") {
    const status = await deploymentService.status(deploymentStatusMatch[1]);
    if (!status.deployment) {
      throw new HttpError(404, "Deployment could not be found.");
    }
    await requirePermission(request, "Project.Read", { projectId: status.deployment.projectId });
    sendJson(response, 200, status);
    return;
  }

  const deploymentRollbackMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/rollback$/);
  if (deploymentRollbackMatch && request.method === "POST") {
    const current = await deploymentService.status(deploymentRollbackMatch[1]);
    if (!current.deployment) {
      throw new HttpError(404, "Deployment could not be found.");
    }
    const context = await requirePermission(request, "Deploy.Rollback", {
      projectId: current.deployment.projectId
    });
    sendJson(
      response,
      200,
      await deploymentService.rollback({
        deploymentId: deploymentRollbackMatch[1],
        user: context.user
      })
    );
    return;
  }

  const deploymentPromoteMatch = pathname.match(/^\/api\/deployments\/([^/]+)\/promote$/);
  if (deploymentPromoteMatch && request.method === "POST") {
    const body = await readJsonBody(request);
    const current = await deploymentService.status(deploymentPromoteMatch[1]);
    if (!current.deployment) {
      throw new HttpError(404, "Deployment could not be found.");
    }
    const context = await requirePermission(request, "Deploy.Promote", {
      projectId: current.deployment.projectId
    });
    sendJson(
      response,
      200,
      await environmentPromotionService.promote({
        deploymentId: deploymentPromoteMatch[1],
        environment: requireString(body.environment, "Environment"),
        user: context.user
      })
    );
    return;
  }

  if (pathname === "/api/organizations" && request.method === "GET") {
    await requirePermission(request, "Project.Read");
    sendJson(response, 200, await supabaseProjectRepository.listOrganizations());
    return;
  }

  if (pathname === "/api/organizations" && request.method === "POST") {
    await requirePermission(request, "Project.Write");
    const body = await readJsonBody(request);
    const now = new Date().toISOString();
    const organization = {
      id: body.id ?? randomUUID(),
      name: requireString(body.name, "Organization name"),
      slug: requireString(body.slug, "Organization slug"),
      created_at: body.created_at ?? now
    };

    sendJson(
      response,
      201,
      await supabaseProjectRepository.createOrganization(organization)
    );
    return;
  }

  if (pathname === "/api/ai/generate" && request.method === "POST") {
    await requirePermission(request, "AI.Execute");
    const body = await readJsonBody(request, 1024 * 1024);
    const prompt = requireString(body.prompt, "Prompt");
    sendJson(response, 200, await aiArchitectService.generateApplication(prompt));
    return;
  }

  if (pathname === "/api/ai/workspace-agent/plan" && request.method === "POST") {
    await requirePermission(request, "AI.Execute");
    const body = await readJsonBody(request, 5 * 1024 * 1024);
    const prompt = requireString(body.prompt, "Prompt");
    sendJson(
      response,
      200,
      await aiWorkspaceAgentPlannerService.plan({
        prompt,
        context: body.context ?? null,
        tools: Array.isArray(body.tools) ? body.tools : []
      })
    );
    return;
  }

  if (pathname === "/api/packages" && request.method === "GET") {
    await requirePermission(request, "Project.Read");
    sendJson(response, 200, await packageRepository.list({
      query: url.searchParams.get("q") ?? undefined,
      type: url.searchParams.get("type") ?? undefined
    }));
    return;
  }

  if (pathname === "/api/monitoring" && request.method === "GET") {
    const projectId = requireString(url.searchParams.get("projectId"), "projectId");
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await monitoringService.dashboard(projectId));
    return;
  }

  if (pathname === "/api/monitoring/health" && request.method === "GET") {
    const projectId = requireString(url.searchParams.get("projectId"), "projectId");
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await monitoringService.health(projectId));
    return;
  }

  if (pathname === "/api/monitoring/api-metrics" && request.method === "GET") {
    const projectId = requireString(url.searchParams.get("projectId"), "projectId");
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await monitoringService.apiMetrics(projectId));
    return;
  }

  if (pathname === "/api/monitoring/workflow-metrics" && request.method === "GET") {
    const projectId = requireString(url.searchParams.get("projectId"), "projectId");
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await monitoringService.workflowMetrics(projectId));
    return;
  }

  if (pathname === "/api/monitoring/deployment-metrics" && request.method === "GET") {
    const projectId = requireString(url.searchParams.get("projectId"), "projectId");
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await monitoringService.deploymentMetrics(projectId));
    return;
  }

  if (pathname === "/api/monitoring/alerts" && request.method === "GET") {
    const projectId = requireString(url.searchParams.get("projectId"), "projectId");
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await monitoringService.alerts(projectId));
    return;
  }

  if (pathname === "/api/monitoring/metrics" && request.method === "POST") {
    const body = await readJsonBody(request);
    const projectId = requireString(body.projectId, "projectId");
    await requirePermission(request, "Project.Write", { projectId });
    sendJson(response, 201, await monitoringService.recordMetric(
      requireString(body.kind, "Metric kind"),
      { ...body.metric, projectId }
    ));
    return;
  }

  if (pathname === "/api/packages" && request.method === "POST") {
    const context = await requirePermission(request, "Project.Write");
    const body = await readJsonBody(request, 5 * 1024 * 1024);
    const published = await packageRepository.publish({ body, user: context.user });
    await rbacRepository.recordAuditEvent({
      action: "Package.Published",
      user: context.user,
      metadata: { packageId: published.id, name: published.name, version: published.version }
    });
    sendJson(response, 201, published);
    return;
  }

  if (pathname === "/api/packages/install" && request.method === "POST") {
    const body = await readJsonBody(request, 5 * 1024 * 1024);
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    const context = await requirePermission(request, "Project.Write", { projectId });
    const installed = await packageRepository.install({
      packageId: requireString(body.packageId ?? body.package, "Package id"),
      projectId,
      user: context.user
    });
    await rbacRepository.recordAuditEvent({
      action: "Package.Installed",
      projectId,
      user: context.user,
      metadata: { packageId: installed.package.id, files: installed.files.map((file) => file.path) }
    });
    if (projectId) {
      await activityRepository.record({
        action: "Package Installed",
        entityId: installed.package.id,
        entityType: "package",
        metadata: { files: installed.files.map((file) => file.path) },
        projectId,
        user: context.user
      });
    }
    sendJson(response, 201, installed);
    return;
  }

  if (pathname === "/api/packages/install" && request.method === "DELETE") {
    const body = await readJsonBody(request);
    const projectId = requireString(body.projectId, "Project id");
    const context = await requirePermission(request, "Project.Write", { projectId });
    const removed = await packageRepository.removeInstall({
      packageId: requireString(body.packageId ?? body.package, "Package id"),
      projectId,
      user: context.user
    });
    await rbacRepository.recordAuditEvent({
      action: "Package.Removed",
      projectId,
      user: context.user,
      metadata: removed
    });
    await activityRepository.record({
      action: "Package Removed",
      entityId: removed.packageId,
      entityType: "package",
      projectId,
      user: context.user
    });
    sendJson(response, 200, removed);
    return;
  }

  const packageMatch = pathname.match(/^\/api\/packages\/(.+)$/);
  if (packageMatch && request.method === "GET") {
    await requirePermission(request, "Project.Read");
    sendJson(response, 200, await packageRepository.get(decodeURIComponent(packageMatch[1])));
    return;
  }

  if (pathname === "/api/projects" && request.method === "GET") {
    const context = await requirePermission(request, "Project.Read");

    if (context.roles.includes("Super Admin")) {
      const projects = await supabaseProjectRepository.listProjects();
      sendJson(
        response,
        200,
        projects.map((project) => ({
          ...project,
          current_user_roles: ["Super Admin"],
          current_user_role: "Super Admin"
        }))
      );
      return;
    }

    const memberships = await rbacRepository.listProjectMembershipsForUser(context.user);
    const membershipByProject = new Map(
      memberships.map((membership) => [membership.projectId, membership])
    );
    const projects = await supabaseProjectRepository.listProjectsByIds(
      memberships.map((membership) => membership.projectId)
    );
    sendJson(
      response,
      200,
      projects.map((project) => {
        const membership = membershipByProject.get(project.id);
        return {
          ...project,
          current_user_roles: membership?.roles ?? [],
          current_user_role: membership?.roles[0] ?? null
        };
      })
    );
    return;
  }

  if (pathname === "/api/projects" && request.method === "POST") {
    const context = await requirePermission(request, "Project.Write");
    const body = await readJsonBody(request);
    const now = new Date().toISOString();
    const project = {
      ...body,
      id: requireString(body.id, "Project id"),
      name: requireString(body.name, "Project name"),
      slug: requireString(body.slug, "Project slug"),
      storage_path: requireString(body.storage_path, "Storage path"),
      created_at: body.created_at ?? now,
      updated_at: body.updated_at ?? now,
      created_by: context.user.id
    };

    const createdProject = await supabaseProjectRepository.createProject(project);
    await projectAdminRepository.upsertMember({
      projectId: createdProject.id,
      role: "Owner",
      userEmail: context.user.email?.toLowerCase() ?? null,
      userId: context.user.id
    });
    sendJson(response, 201, createdProject);
    return;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && request.method === "GET") {
    await requirePermission(request, "Project.Read", { projectId: projectMatch[1] });
    const project = await supabaseProjectRepository.getProject(projectMatch[1]);
    if (!project) {
      throw new HttpError(404, "Project could not be found.");
    }

    sendJson(response, 200, project);
    return;
  }

  const projectAdminMatch = pathname.match(/^\/api\/projects\/([^/]+)\/admin$/);
  if (projectAdminMatch && request.method === "GET") {
    const projectId = projectAdminMatch[1];
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await projectAdminService.overview(projectId));
    return;
  }

  const projectPresenceMatch = pathname.match(/^\/api\/projects\/([^/]+)\/presence$/);
  if (projectPresenceMatch && request.method === "GET") {
    const projectId = projectPresenceMatch[1];
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await presenceRepository.list(projectId));
    return;
  }

  if (projectPresenceMatch && request.method === "PUT") {
    const projectId = projectPresenceMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    const body = await readJsonBody(request);
    const presence = await presenceRepository.upsert({
      currentFile: typeof body.currentFile === "string" ? body.currentFile : null,
      projectId,
      status: typeof body.status === "string" ? body.status : "online",
      user: context.user
    });
    sendJson(response, 200, presence);
    return;
  }

  if (projectPresenceMatch && request.method === "DELETE") {
    const projectId = projectPresenceMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await presenceRepository.remove(projectId, context.user.id);
    sendNoContent(response);
    return;
  }

  const projectActivityMatch = pathname.match(/^\/api\/projects\/([^/]+)\/activity$/);
  if (projectActivityMatch && request.method === "GET") {
    const projectId = projectActivityMatch[1];
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await activityRepository.list(projectId, Number(url.searchParams.get("limit") ?? 100)));
    return;
  }

  if (projectActivityMatch && request.method === "POST") {
    const projectId = projectActivityMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    const body = await readJsonBody(request);
    const activity = await activityRepository.record({
      action: requireString(body.action, "Activity action"),
      entityId: typeof body.entityId === "string" ? body.entityId : null,
      entityType: typeof body.entityType === "string" ? body.entityType : null,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      projectId,
      user: context.user
    });
    await rbacRepository.recordAuditEvent({
      action: `Activity:${activity.action}`,
      projectId,
      user: context.user,
      metadata: { activityId: activity.id }
    });
    sendJson(response, 201, activity);
    return;
  }

  const projectCommentsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/comments$/);
  if (projectCommentsMatch && request.method === "GET") {
    const projectId = projectCommentsMatch[1];
    await requirePermission(request, "Project.Read", { projectId });
    sendJson(response, 200, await commentRepository.list(projectId, {
      targetId: url.searchParams.get("targetId") ?? undefined,
      targetType: url.searchParams.get("targetType") ?? undefined
    }));
    return;
  }

  if (projectCommentsMatch && request.method === "POST") {
    const projectId = projectCommentsMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    const body = await readJsonBody(request);
    const comment = await commentRepository.create({ body, projectId, user: context.user });
    await activityRepository.record({
      action: "Comment Added",
      entityId: comment.id,
      entityType: comment.target_type,
      metadata: { targetId: comment.target_id, filePath: comment.file_path },
      projectId,
      user: context.user
    });
    await rbacRepository.recordAuditEvent({
      action: "Comment.Added",
      projectId,
      user: context.user,
      metadata: { commentId: comment.id, targetType: comment.target_type }
    });
    sendJson(response, 201, comment);
    return;
  }

  const projectCommentMatch = pathname.match(/^\/api\/projects\/([^/]+)\/comments\/([^/]+)$/);
  if (projectCommentMatch && request.method === "PATCH") {
    const projectId = projectCommentMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    const body = await readJsonBody(request);
    const comment = await commentRepository.update(projectId, projectCommentMatch[2], body);
    await activityRepository.record({
      action: comment.status === "resolved" ? "Comment Resolved" : "Comment Updated",
      entityId: comment.id,
      entityType: comment.target_type,
      metadata: { status: comment.status },
      projectId,
      user: context.user
    });
    sendJson(response, 200, comment);
    return;
  }

  if (projectCommentMatch && request.method === "DELETE") {
    const projectId = projectCommentMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await commentRepository.delete(projectId, projectCommentMatch[2]);
    await activityRepository.record({
      action: "Comment Deleted",
      entityId: projectCommentMatch[2],
      entityType: "comment",
      projectId,
      user: context.user
    });
    sendNoContent(response);
    return;
  }

  const projectMembersMatch = pathname.match(/^\/api\/projects\/([^/]+)\/admin\/members$/);
  if (projectMembersMatch && request.method === "POST") {
    const projectId = projectMembersMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await projectAdminService.requireProjectAdmin(context, projectId);
    const body = await readJsonBody(request);
    sendJson(
      response,
      201,
      await projectAdminService.inviteMember({ body, projectId, user: context.user })
    );
    return;
  }

  const projectMemberMatch = pathname.match(/^\/api\/projects\/([^/]+)\/admin\/members\/([^/]+)$/);
  if (projectMemberMatch && request.method === "PATCH") {
    const projectId = projectMemberMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await projectAdminService.requireProjectAdmin(context, projectId);
    const body = await readJsonBody(request);
    sendJson(
      response,
      200,
      await projectAdminService.changeRole({
        body,
        memberId: projectMemberMatch[2],
        projectId,
        user: context.user
      })
    );
    return;
  }

  if (projectMemberMatch && request.method === "DELETE") {
    const projectId = projectMemberMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await projectAdminService.requireProjectAdmin(context, projectId);
    await projectAdminService.removeMember({
      memberId: projectMemberMatch[2],
      projectId,
      user: context.user
    });
    sendNoContent(response);
    return;
  }

  const projectCredentialsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/admin\/git-credentials$/);
  if (projectCredentialsMatch && request.method === "POST") {
    const projectId = projectCredentialsMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await projectAdminService.requireProjectAdmin(context, projectId);
    const body = await readJsonBody(request);
    sendJson(
      response,
      201,
      await projectAdminService.createCredential({ body, projectId, user: context.user })
    );
    return;
  }

  const projectAdminGitMatch = pathname.match(/^\/api\/projects\/([^/]+)\/admin\/git$/);
  if (projectAdminGitMatch && request.method === "POST") {
    const projectId = projectAdminGitMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await projectAdminService.requireProjectAdmin(context, projectId);
    const body = await readJsonBody(request);
    sendJson(
      response,
      201,
      await projectAdminService.connectGit({ body, projectId, user: context.user })
    );
    return;
  }

  if (projectAdminGitMatch && request.method === "DELETE") {
    const projectId = projectAdminGitMatch[1];
    const context = await requirePermission(request, "Project.Write", { projectId });
    await projectAdminService.requireProjectAdmin(context, projectId);
    await projectAdminService.disconnectGit({ projectId, user: context.user });
    sendNoContent(response);
    return;
  }

  if (projectMatch && request.method === "PATCH") {
    await requirePermission(request, "Project.Write", { projectId: projectMatch[1] });
    const body = await readJsonBody(request);
    const project = await supabaseProjectRepository.updateProject(projectMatch[1], {
      ...body,
      updated_at: body.updated_at ?? new Date().toISOString()
    });
    sendJson(response, 200, project);
    return;
  }

  if (projectMatch && request.method === "DELETE") {
    const projectId = projectMatch[1];
    const context = await requirePermission(request, "Project.Delete", { projectId });
    sendJson(
      response,
      200,
      await projectDeletionService.deleteProject({
        projectId,
        user: context.user
      })
    );
    return;
  }

  if (pathname === "/api/project-versions" && request.method === "POST") {
    const body = await readJsonBody(request);
    const projectId = requireString(body.projectId, "Project id");
    await requireAnyPermission(request, ["AI.Approve", "AI.Rollback"], { projectId });
    const version = {
      id: randomUUID(),
      project_id: projectId,
      version_number: Number(body.versionNumber),
      snapshot_path: requireString(body.snapshotPath, "Snapshot path"),
      created_by: requireString(body.createdBy, "Creator id"),
      created_at: new Date().toISOString()
    };

    sendJson(response, 201, await supabaseProjectRepository.createVersion(version));
    return;
  }

  if (pathname === "/api/project-versions" && request.method === "GET") {
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      throw new HttpError(400, "projectId is required.");
    }
    await requirePermission(request, "Project.Read", { projectId });

    sendJson(
      response,
      200,
      await supabaseProjectRepository.listProjectVersions(projectId)
    );
    return;
  }

  const versionMatch = pathname.match(/^\/api\/project-versions\/([^/]+)$/);
  if (versionMatch && request.method === "DELETE") {
    await requirePermission(request, "AI.Rollback");
    await supabaseProjectRepository.deleteVersion(versionMatch[1]);
    sendNoContent(response);
    return;
  }

  if (pathname === "/api/project-files/bulk" && request.method === "POST") {
    const body = await readJsonBody(request, 5 * 1024 * 1024);
    const projectId = requireString(body.projectId, "Project id");
    await requirePermission(request, "Project.Write", { projectId });
    sendJson(
      response,
      201,
      await supabaseProjectRepository.registerProjectFiles(
        projectId,
        Array.isArray(body.files) ? body.files : []
      )
    );
    return;
  }

  const folderMatch = pathname.match(/^\/api\/storage\/projects\/([^/]+)\/folder$/);
  if (folderMatch && request.method === "POST") {
    await requirePermission(request, "Project.Write", { projectId: folderMatch[1] });
    await gcsStorageRepository.createProjectFolder(folderMatch[1]);
    sendNoContent(response);
    return;
  }

  if (pathname === "/api/storage/files" && request.method === "PUT") {
    const body = await readJsonBody(request, 5 * 1024 * 1024);
    const storagePath = requireString(body.path, "Storage path");
    await requirePermission(request, "Project.Write", {
      projectId: getProjectIdFromStoragePath(storagePath)
    });
    await gcsStorageRepository.uploadFile(
      storagePath,
      typeof body.content === "string" ? body.content : ""
    );
    sendNoContent(response);
    return;
  }

  if (pathname === "/api/storage/files" && request.method === "GET") {
    const objectPath = url.searchParams.get("path");
    const prefix = url.searchParams.get("prefix");
    await requirePermission(request, "Project.Read", {
      projectId: getProjectIdFromStoragePath(objectPath ?? prefix ?? "")
    });

    if (objectPath) {
      sendJson(response, 200, {
        content: await gcsStorageRepository.downloadFile(objectPath)
      });
      return;
    }

    if (prefix) {
      sendJson(response, 200, await gcsStorageRepository.listFiles(prefix));
      return;
    }

    throw new HttpError(400, "path or prefix is required.");
  }

  if (pathname === "/api/storage/files" && request.method === "DELETE") {
    const objectPath = url.searchParams.get("path");
    if (!objectPath) {
      throw new HttpError(400, "path is required.");
    }
    await requirePermission(request, "Project.Delete", {
      projectId: getProjectIdFromStoragePath(objectPath)
    });

    await gcsStorageRepository.deleteFile(objectPath);
    sendNoContent(response);
    return;
  }

  throw new HttpError(404, "Route could not be found.");
}

function getProjectIdFromStoragePath(storagePath) {
  const match = String(storagePath).match(/^projects\/([^/]+)\//);
  return match?.[1];
}
