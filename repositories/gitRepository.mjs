import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "git-metadata.json");

const emptyDb = {
  git_connections: []
};

export class GitRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async upsertConnection(connection) {
    const record = {
      id: connection.id ?? randomUUID(),
      project_id: connection.project_id,
      provider: connection.provider,
      owner: connection.owner,
      repository: connection.repository,
      default_branch: connection.default_branch,
      credential_id: connection.credential_id ?? null,
      created_by: connection.created_by,
      created_at: connection.created_at ?? new Date().toISOString()
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.git_connections = [
        ...db.git_connections.filter((item) => item.project_id !== record.project_id),
        record
      ];
      await writeLocalDb(db);
      return record;
    }

    const [created] = await this.supabaseRequest(
      "git_connections?on_conflict=project_id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      }
    );

    return created;
  }

  async getConnection(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.git_connections.find((item) => item.project_id === projectId) ?? null;
    }

    const records = await this.supabaseRequest(
      `git_connections?project_id=eq.${encodeURIComponent(projectId)}&select=*`
    );

    return records[0] ?? null;
  }

  async deleteConnection(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.git_connections = db.git_connections.filter((item) => item.project_id !== projectId);
      await writeLocalDb(db);
      return;
    }

    await this.supabaseRequest(
      `git_connections?project_id=eq.${encodeURIComponent(projectId)}`,
      { method: "DELETE" }
    );
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

export const gitRepository = new GitRepository();
