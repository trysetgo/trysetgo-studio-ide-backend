import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

export const defaultPermissions = [
  "Project.Read",
  "Project.Write",
  "Project.Delete",
  "Version.Restore",
  "AI.Execute",
  "AI.Approve",
  "AI.Rollback",
  "Deploy.Publish",
  "Deploy.Rollback",
  "Deploy.Promote"
];

const defaultRolePermissions = {
  "Super Admin": defaultPermissions,
  Owner: defaultPermissions,
  Admin: defaultPermissions,
  Developer: ["Project.Read", "Project.Write", "AI.Execute", "AI.Approve"],
  Viewer: ["Project.Read"],
  "AI Agent": ["Project.Read", "Project.Write", "AI.Execute"]
};

export class RBACRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async getUserPermissions(user, organizationId) {
    if (!this.isConfigured()) {
      return this.getLocalUserAccess(user);
    }

    try {
      const userRoles = await this.supabaseRequest(
        `user_roles?user_id=eq.${encodeURIComponent(user.id)}&select=role_id,organization_id`
      );
      const scopedRoles = userRoles.filter(
        (role) => !organizationId || !role.organization_id || role.organization_id === organizationId
      );

      if (scopedRoles.length === 0) {
        return this.getBootstrapAccess(user);
      }

      const roleIds = scopedRoles.map((role) => role.role_id).filter(Boolean);
      const roleFilter = roleIds.map((roleId) => `"${roleId}"`).join(",");
      const [roles, rolePermissions] = await Promise.all([
        this.supabaseRequest(`roles?id=in.(${roleFilter})&select=id,name`),
        this.supabaseRequest(`role_permissions?role_id=in.(${roleFilter})&select=role_id,permission`)
      ]);

      return {
        roles: roles.map((role) => role.name),
        permissions: Array.from(new Set(rolePermissions.map((item) => item.permission)))
      };
    } catch {
      return this.getBootstrapAccess(user);
    }
  }

  async getProjectMemberAccess(user, projectId) {
    if (!projectId) {
      return { roles: [], permissions: [] };
    }

    if (!this.isConfigured()) {
      return this.getLocalUserAccess(user);
    }

    try {
      const queries = [
        this.supabaseRequest(
          `project_members?project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(user.id)}&select=role`
        )
      ];

      if (user.email) {
        queries.push(
          this.supabaseRequest(
            `project_members?project_id=eq.${encodeURIComponent(projectId)}&user_email=eq.${encodeURIComponent(user.email.toLowerCase())}&select=role`
          )
        );
      }

      const results = (await Promise.all(queries)).flat();
      const roles = Array.from(
        new Set(
          results
            .map((member) => member.role)
            .filter((role) => typeof role === "string" && role.length > 0)
        )
      );

      return {
        roles,
        permissions: Array.from(
          new Set(
            roles.flatMap((role) => defaultRolePermissions[role] ?? [])
          )
        )
      };
    } catch {
      return { roles: [], permissions: [] };
    }
  }

  async listProjectMembershipsForUser(user) {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const queries = [
        this.supabaseRequest(
          `project_members?user_id=eq.${encodeURIComponent(user.id)}&select=project_id,role`
        )
      ];

      if (user.email) {
        queries.push(
          this.supabaseRequest(
            `project_members?user_email=eq.${encodeURIComponent(user.email.toLowerCase())}&select=project_id,role`
          )
        );
      }

      const memberships = (await Promise.all(queries)).flat();
      const byProject = new Map();

      for (const membership of memberships) {
        if (!membership.project_id || !membership.role) {
          continue;
        }

        const current = byProject.get(membership.project_id) ?? {
          projectId: membership.project_id,
          roles: []
        };
        current.roles = Array.from(new Set([...current.roles, membership.role]));
        byProject.set(membership.project_id, current);
      }

      return Array.from(byProject.values()).map((membership) => ({
        ...membership,
        permissions: Array.from(
          new Set(
            membership.roles.flatMap((role) => defaultRolePermissions[role] ?? [])
          )
        )
      }));
    } catch {
      return [];
    }
  }

  async recordAuditEvent({ action, metadata = {}, projectId, user }) {
    const event = {
      id: randomUUID(),
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      action,
      project_id: projectId ?? null,
      metadata,
      created_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      return event;
    }

    try {
      await this.supabaseRequest("audit_logs", {
        method: "POST",
        body: JSON.stringify(event)
      });
    } catch {
      return event;
    }

    return event;
  }

  getBootstrapAccess(user) {
    const email = user?.email?.toLowerCase() ?? "";
    if (email === "admin@trysetgo.com" || email.endsWith("@trysetgo.com")) {
      return {
        roles: ["Super Admin"],
        permissions: defaultPermissions
      };
    }

    return {
      roles: ["Viewer"],
      permissions: defaultRolePermissions.Viewer
    };
  }

  getLocalUserAccess(user) {
    return {
      roles: ["Owner"],
      permissions: defaultPermissions,
      user
    };
  }

  mergeAccess(...accessEntries) {
    return {
      roles: Array.from(new Set(accessEntries.flatMap((entry) => entry.roles ?? []))),
      permissions: Array.from(
        new Set(accessEntries.flatMap((entry) => entry.permissions ?? []))
      )
    };
  }

  async supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${pathname}`, {
      ...init,
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
        "Accept-Profile": config.supabaseSchema,
        "Content-Profile": config.supabaseSchema,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }

    if (response.status === 204) {
      return [];
    }

    return response.json();
  }
}

export const rbacRepository = new RBACRepository();
