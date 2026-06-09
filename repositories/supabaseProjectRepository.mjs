import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "metadata.json");

const emptyDb = {
  organizations: [],
  projects: [],
  project_files: [],
  project_versions: []
};

const projectScopedTables = [
  "project_files",
  "project_versions",
  "project_members",
  "project_settings",
  "workflow_history",
  "workflow_instances",
  "project_comments",
  "project_activity",
  "project_presence",
  "deployment_logs",
  "deployments",
  "application_metrics",
  "api_metrics",
  "workflow_metrics",
  "deployment_metrics",
  "migration_history",
  "monitoring_metrics",
  "alerts",
  "monitoring_alerts",
  "package_installs",
  "git_connections",
  "audit_logs"
];

export class SupabaseProjectRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async createProject(project) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.projects = [...db.projects.filter((item) => item.id !== project.id), project];
      await writeLocalDb(db);
      return project;
    }

    if (project.organization_id === config.defaultOrganizationId) {
      await this.ensureDefaultOrganization();
    }

    const [created] = await this.supabaseRequest("projects", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(project)
    });

    return created;
  }

  async createOrganization(organization) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.organizations = upsertLocalOrganization(db.organizations, organization);
      await writeLocalDb(db);
      return organization;
    }

    const [created] = await this.supabaseRequest("organizations?on_conflict=slug", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(organization)
    });

    return created;
  }

  async listOrganizations() {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return [...db.organizations].sort((a, b) => a.name.localeCompare(b.name));
    }

    return this.supabaseRequest("organizations?select=*&order=name.asc");
  }

  async ensureDefaultOrganization() {
    if (!this.isConfigured()) {
      return createDefaultOrganization();
    }

    const [organization] = await this.supabaseRequest(
      "organizations?on_conflict=id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(createDefaultOrganization())
      }
    );

    return organization;
  }

  async updateProject(projectId, patch) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      const current = db.projects.find((project) => project.id === projectId);
      if (!current) {
        throw new HttpError(404, "Project could not be found.");
      }

      const updated = { ...current, ...patch };
      db.projects = db.projects.map((project) =>
        project.id === projectId ? updated : project
      );
      await writeLocalDb(db);
      return updated;
    }

    const [updated] = await this.supabaseRequest(
      `projects?id=eq.${encodeURIComponent(projectId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch)
      }
    );

    if (!updated) {
      throw new HttpError(404, "Project could not be found.");
    }

    return updated;
  }

  async getProject(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.projects.find((project) => project.id === projectId) ?? null;
    }

    const records = await this.supabaseRequest(
      `projects?id=eq.${encodeURIComponent(projectId)}&select=*`
    );

    return records[0] ?? null;
  }

  async listProjects() {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return [...db.projects].sort((a, b) =>
        b.updated_at.localeCompare(a.updated_at)
      );
    }

    return this.supabaseRequest("projects?select=*&order=updated_at.desc");
  }

  async listProjectsByIds(projectIds) {
    const ids = Array.from(new Set(projectIds.filter(Boolean)));
    if (ids.length === 0) {
      return [];
    }

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.projects
        .filter((project) => ids.includes(project.id))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }

    const filter = ids.map((id) => `"${id}"`).join(",");
    return this.supabaseRequest(
      `projects?id=in.(${filter})&select=*&order=updated_at.desc`
    );
  }

  async createVersion(version) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_versions = [
        ...db.project_versions.filter((item) => item.id !== version.id),
        version
      ];
      await writeLocalDb(db);
      return version;
    }

    const [created] = await this.supabaseRequest("project_versions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(version)
    });

    return created;
  }

  async listProjectVersions(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.project_versions
        .filter((version) => version.project_id === projectId)
        .sort((a, b) => b.version_number - a.version_number);
    }

    return this.supabaseRequest(
      `project_versions?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=version_number.desc`
    );
  }

  async deleteVersion(versionId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_versions = db.project_versions.filter(
        (version) => version.id !== versionId
      );
      await writeLocalDb(db);
      return;
    }

    await this.supabaseRequest(
      `project_versions?id=eq.${encodeURIComponent(versionId)}`,
      {
        method: "DELETE"
      }
    );
  }

  async deleteProject(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      const project = db.projects.find((item) => item.id === projectId);
      const summary = {
        project_files: db.project_files.filter((item) => item.project_id === projectId).length,
        project_versions: db.project_versions.filter((item) => item.project_id === projectId).length,
        projects: project ? 1 : 0
      };

      db.project_files = db.project_files.filter((item) => item.project_id !== projectId);
      db.project_versions = db.project_versions.filter((item) => item.project_id !== projectId);
      db.projects = db.projects.filter((item) => item.id !== projectId);
      await writeLocalDb(db);
      return summary;
    }

    const summary = {};
    for (const table of projectScopedTables) {
      summary[table] = await this.deleteProjectScopedRows(table, projectId);
    }

    const deletedProjects = await this.supabaseRequest(
      `projects?id=eq.${encodeURIComponent(projectId)}`,
      {
        method: "DELETE",
        headers: { Prefer: "return=representation" }
      }
    );
    summary.projects = Array.isArray(deletedProjects) ? deletedProjects.length : 0;
    return summary;
  }

  async deleteProjectScopedRows(table, projectId) {
    try {
      const deletedRows = await this.supabaseRequest(
        `${table}?project_id=eq.${encodeURIComponent(projectId)}`,
        {
          method: "DELETE",
          headers: { Prefer: "return=representation" }
        }
      );
      return Array.isArray(deletedRows) ? deletedRows.length : 0;
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 404 ||
          error.message.includes("does not exist") ||
          error.message.includes("Could not find") ||
          error.message.includes("schema cache"))
      ) {
        return 0;
      }

      throw error;
    }
  }

  async registerProjectFiles(projectId, files) {
    const now = new Date().toISOString();
    const records = files.map((file) => ({
      project_id: projectId,
      path: file.path,
      storage_path: file.storagePath,
      content_type: file.contentType,
      size_bytes: Number(file.sizeBytes ?? 0),
      updated_at: now
    }));

    if (records.length === 0) {
      return [];
    }

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_files = [
        ...db.project_files.filter((file) => file.project_id !== projectId),
        ...records.map((record) => ({
          id: randomUUID(),
          created_at: now,
          ...record
        }))
      ];
      await writeLocalDb(db);
      return records;
    }

    try {
      return await this.supabaseRequest("project_files?on_conflict=project_id,path", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(records)
      });
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 404 || error.message.includes("project_files"))
      ) {
        return [];
      }

      throw error;
    }
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

async function readLocalDb() {
  try {
    const content = await fs.readFile(dbPath, "utf8");
    return { ...emptyDb, ...JSON.parse(content) };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return { ...emptyDb };
  }
}

async function writeLocalDb(db) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

export const supabaseProjectRepository = new SupabaseProjectRepository();

function createDefaultOrganization() {
  return {
    id: config.defaultOrganizationId,
    name: config.defaultOrganizationName,
    slug: config.defaultOrganizationSlug
  };
}

function upsertLocalOrganization(organizations, organization) {
  return [
    organization,
    ...organizations.filter((item) => item.id !== organization.id)
  ];
}
