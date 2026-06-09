import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "collaboration-presence.json");
const emptyDb = { project_presence: [] };

export class PresenceRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async list(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.project_presence
        .filter((entry) => entry.project_id === projectId)
        .sort((a, b) => b.last_seen.localeCompare(a.last_seen));
    }

    return this.supabaseRequest(
      `project_presence?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=last_seen.desc`
    );
  }

  async upsert({ currentFile, projectId, status, user }) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      project_id: projectId,
      user_id: user.id,
      user_email: user.email ?? null,
      current_file: currentFile ?? null,
      status: status ?? "online",
      last_seen: now,
      created_at: now
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_presence = [
        record,
        ...db.project_presence.filter(
          (entry) => !(entry.project_id === projectId && entry.user_id === user.id)
        )
      ];
      await writeLocalDb(db);
      return record;
    }

    const [created] = await this.supabaseRequest("project_presence?on_conflict=project_id,user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(record)
    });

    return created;
  }

  async remove(projectId, userId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_presence = db.project_presence.filter(
        (entry) => !(entry.project_id === projectId && entry.user_id === userId)
      );
      await writeLocalDb(db);
      return;
    }

    await this.supabaseRequest(
      `project_presence?project_id=eq.${encodeURIComponent(projectId)}&user_id=eq.${encodeURIComponent(userId)}`,
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

export const presenceRepository = new PresenceRepository();
