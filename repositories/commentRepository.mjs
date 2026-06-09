import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "collaboration-comments.json");
const emptyDb = { project_comments: [] };
const allowedTargets = new Set(["project", "file", "deployment"]);

export class CommentRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async list(projectId, { targetId, targetType } = {}) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.project_comments
        .filter((comment) => comment.project_id === projectId)
        .filter((comment) => !targetType || comment.target_type === targetType)
        .filter((comment) => !targetId || comment.target_id === targetId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    const filters = [
      `project_id=eq.${encodeURIComponent(projectId)}`,
      "select=*",
      "order=created_at.desc"
    ];

    if (targetType) filters.push(`target_type=eq.${encodeURIComponent(targetType)}`);
    if (targetId) filters.push(`target_id=eq.${encodeURIComponent(targetId)}`);

    return this.supabaseRequest(`project_comments?${filters.join("&")}`);
  }

  async create({ body, projectId, user }) {
    const targetType = normalizeTargetType(body.targetType ?? body.target_type ?? "project");
    const now = new Date().toISOString();
    const comment = {
      id: randomUUID(),
      project_id: projectId,
      target_type: targetType,
      target_id: typeof body.targetId === "string" ? body.targetId : body.target_id ?? projectId,
      file_path: typeof body.filePath === "string" ? body.filePath : body.file_path ?? null,
      deployment_id: typeof body.deploymentId === "string" ? body.deploymentId : body.deployment_id ?? null,
      body: requireCommentBody(body.body),
      status: "open",
      created_by: user.id,
      created_by_email: user.email ?? null,
      created_at: now,
      updated_at: now
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_comments = [comment, ...db.project_comments];
      await writeLocalDb(db);
      return comment;
    }

    const [created] = await this.supabaseRequest("project_comments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(comment)
    });

    return created;
  }

  async update(projectId, commentId, patch) {
    const update = {
      ...(typeof patch.body === "string" ? { body: requireCommentBody(patch.body) } : {}),
      ...(typeof patch.status === "string" ? { status: patch.status } : {}),
      updated_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      const current = db.project_comments.find(
        (comment) => comment.id === commentId && comment.project_id === projectId
      );
      if (!current) throw new HttpError(404, "Comment could not be found.");
      const updated = { ...current, ...update };
      db.project_comments = db.project_comments.map((comment) =>
        comment.id === commentId ? updated : comment
      );
      await writeLocalDb(db);
      return updated;
    }

    const [updated] = await this.supabaseRequest(
      `project_comments?id=eq.${encodeURIComponent(commentId)}&project_id=eq.${encodeURIComponent(projectId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(update)
      }
    );

    if (!updated) throw new HttpError(404, "Comment could not be found.");
    return updated;
  }

  async delete(projectId, commentId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_comments = db.project_comments.filter(
        (comment) => !(comment.id === commentId && comment.project_id === projectId)
      );
      await writeLocalDb(db);
      return;
    }

    await this.supabaseRequest(
      `project_comments?id=eq.${encodeURIComponent(commentId)}&project_id=eq.${encodeURIComponent(projectId)}`,
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

function normalizeTargetType(value) {
  const normalized = String(value ?? "project").trim().toLowerCase();
  if (!allowedTargets.has(normalized)) {
    throw new HttpError(400, "Comment targetType must be project, file, or deployment.");
  }
  return normalized;
}

function requireCommentBody(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "Comment body is required.");
  }
  return value.trim().slice(0, 4000);
}

export const commentRepository = new CommentRepository();
