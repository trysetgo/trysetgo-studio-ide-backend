import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "collaboration-activity.json");
const emptyDb = { project_activity: [] };

export class ActivityRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async list(projectId, limit = 100) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.project_activity
        .filter((entry) => entry.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
    }

    return this.supabaseRequest(
      `project_activity?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc&limit=${Number(limit) || 100}`
    );
  }

  async record({ action, entityId = null, entityType = null, metadata = {}, projectId, user }) {
    const activity = {
      id: randomUUID(),
      project_id: projectId,
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
      created_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_activity = [activity, ...db.project_activity].slice(0, 500);
      await writeLocalDb(db);
      return activity;
    }

    const [created] = await this.supabaseRequest("project_activity", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(activity)
    });

    return created;
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

export const activityRepository = new ActivityRepository();
