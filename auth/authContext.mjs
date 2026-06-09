import { config } from "../config.mjs";
import { organizationMemberRepository } from "../repositories/organizationMemberRepository.mjs";
import { rbacRepository } from "../repositories/rbacRepository.mjs";
import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";
import { HttpError } from "../utils/http.mjs";

export async function getAuthContext(request) {
  const token = getBearerToken(request);

  if (!token) {
    if (!config.supabaseUrl) {
      const user = {
        id: "00000000-0000-4000-8000-000000000002",
        email: "local@trysetgo.dev"
      };
      const access = await rbacRepository.getUserPermissions(user);
      return { user, ...access, token: null };
    }

    throw new HttpError(401, "Authentication is required.");
  }

  const user = await verifySupabaseToken(token);
  const access = await rbacRepository.getUserPermissions(user);
  return { user, ...access, token };
}

export async function getProjectAwareAuthContext(request, projectId) {
  return getProjectAwareContext(request, projectId);
}

export async function requirePermission(request, permission, metadata = {}) {
  const context = await getProjectAwareContext(request, metadata.projectId);

  if (!context.permissions.includes(permission)) {
    await rbacRepository.recordAuditEvent({
      action: `Denied:${permission}`,
      metadata,
      projectId: metadata.projectId,
      user: context.user
    });
    throw new HttpError(403, `Permission denied: ${permission}`);
  }

  await rbacRepository.recordAuditEvent({
    action: `Allowed:${permission}`,
    metadata,
    projectId: metadata.projectId,
    user: context.user
  });
  return context;
}

export async function requireAnyPermission(request, permissions, metadata = {}) {
  const context = await getProjectAwareContext(request, metadata.projectId);

  if (!permissions.some((permission) => context.permissions.includes(permission))) {
    await rbacRepository.recordAuditEvent({
      action: `Denied:${permissions.join("|")}`,
      metadata,
      projectId: metadata.projectId,
      user: context.user
    });
    throw new HttpError(403, `Permission denied: ${permissions.join(" or ")}`);
  }

  await rbacRepository.recordAuditEvent({
    action: `Allowed:${permissions.join("|")}`,
    metadata,
    projectId: metadata.projectId,
    user: context.user
  });
  return context;
}

async function getProjectAwareContext(request, projectId) {
  const context = await getAuthContext(request);
  if (!projectId) {
    return context;
  }

  if (context.roles.includes("Super Admin")) {
    return context;
  }

  const project = await supabaseProjectRepository.getProject(projectId);
  if (!project) {
    return {
      ...context,
      roles: [],
      permissions: []
    };
  }

  const hasOrganizationMembership = await organizationMemberRepository.hasMembership(
    context.user,
    project.organization_id
  );
  if (!hasOrganizationMembership) {
    await rbacRepository.recordAuditEvent({
      action: "Organization.AccessDenied",
      metadata: { organizationId: project.organization_id, projectId },
      projectId,
      user: context.user
    });
    return {
      ...context,
      roles: [],
      permissions: []
    };
  }

  const projectAccess = await rbacRepository.getProjectMemberAccess(
    context.user,
    projectId
  );
  const globalNonProjectPermissions = (context.permissions ?? []).filter(
    (permission) => !permission.startsWith("Project.") && !permission.startsWith("Deploy.") && permission !== "Version.Restore"
  );
  const mergedAccess = rbacRepository.mergeAccess(projectAccess, {
    roles: [],
    permissions: globalNonProjectPermissions
  });

  return {
    ...context,
    roles: mergedAccess.roles,
    permissions: mergedAccess.permissions
  };
}

export async function optionalAuthContext(request) {
  try {
    return await getAuthContext(request);
  } catch {
    return null;
  }
}

function getBearerToken(request) {
  const header = request.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function verifySupabaseToken(token) {
  if (!config.supabaseUrl) {
    return {
      id: "00000000-0000-4000-8000-000000000002",
      email: "local@trysetgo.dev"
    };
  }

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseAnonKey ?? config.supabaseServiceKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new HttpError(401, "Invalid or expired session.");
  }

  const user = await response.json();
  return {
    id: user.id,
    email: user.email,
    raw: user
  };
}
