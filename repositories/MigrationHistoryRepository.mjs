import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "migration-history.json");
const emptyDb = { migration_history: [] };

export class MigrationHistoryRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async create(record) {
    const now = new Date().toISOString();
    const migration = {
      id: record.id ?? randomUUID(),
      project_id: record.projectId ?? record.project_id,
      migration_name: record.migrationName ?? record.migration_name,
      provider: record.provider,
      status: record.status ?? "Running",
      started_at: record.startedAt ?? record.started_at ?? now,
      completed_at: record.completedAt ?? record.completed_at ?? null,
      error: record.error ?? null
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.migration_history = [migration, ...db.migration_history];
      await writeLocalDb(db);
      return migration;
    }

    const [created] = await this.supabaseRequest("migration_history", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(migration)
    });
    return created;
  }

  async update(id, patch) {
    const update = {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      completed_at: patch.completedAt ?? patch.completed_at ?? new Date().toISOString()
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.migration_history = db.migration_history.map((item) =>
        item.id === id ? { ...item, ...update } : item
      );
      await writeLocalDb(db);
      return db.migration_history.find((item) => item.id === id) ?? null;
    }

    const [updated] = await this.supabaseRequest(
      `migration_history?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(update)
      }
    );
    return updated ?? null;
  }

  async list(projectId, limit = 100) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.migration_history
        .filter((item) => item.project_id === projectId)
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
        .slice(0, limit);
    }

    return this.supabaseRequest(
      `migration_history?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=started_at.desc&limit=${Number(limit) || 100}`
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

    if (!response.ok) throw new HttpError(response.status, await response.text());
    if (response.status === 204) return [];
    return response.json();
  }
}

async function readLocalDb() {
  try {
    return { ...emptyDb, ...JSON.parse(await fs.readFile(dbPath, "utf8")) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ...emptyDb };
  }
}

async function writeLocalDb(db) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

export const migrationHistoryRepository = new MigrationHistoryRepository();
