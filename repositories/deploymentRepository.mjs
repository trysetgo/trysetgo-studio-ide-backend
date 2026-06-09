import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { supabaseProjectRepository } from "./supabaseProjectRepository.mjs";

const dbPath = path.join(config.dataDir, "deployments.json");
const emptyDb = {
  deployments: [],
  deployment_logs: []
};

export class DeploymentRepository {
  isConfigured() {
    return supabaseProjectRepository.isConfigured();
  }

  async createDeployment(record) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.deployments = [record, ...db.deployments.filter((item) => item.id !== record.id)];
      await writeLocalDb(db);
      return record;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest("deployments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toDatabaseDeployment(record))
    });
    return fromDatabaseDeployment(created);
  }

  async updateDeployment(id, patch) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.deployments = db.deployments.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      );
      await writeLocalDb(db);
      return db.deployments.find((item) => item.id === id) ?? null;
    }

    const [updated] = await supabaseProjectRepository.supabaseRequest(
      `deployments?id=eq.${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(toDatabaseDeploymentPatch(patch))
      }
    );
    return updated ? fromDatabaseDeployment(updated) : null;
  }

  async listDeployments(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.deployments
        .filter((item) => item.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `deployments?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc`
    );
    return rows.map(fromDatabaseDeployment);
  }

  async getDeployment(id) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.deployments.find((item) => item.id === id) ?? null;
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `deployments?id=eq.${encodeURIComponent(id)}&select=*`
    );
    return rows[0] ? fromDatabaseDeployment(rows[0]) : null;
  }

  async addLog(log) {
    const record = {
      id: log.id ?? randomUUID(),
      createdAt: log.createdAt ?? new Date().toISOString(),
      ...log
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.deployment_logs = [...db.deployment_logs, record];
      await writeLocalDb(db);
      return record;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest("deployment_logs", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: record.id,
        deployment_id: record.deploymentId,
        project_id: record.projectId,
        level: record.level,
        phase: record.phase,
        message: record.message,
        metadata: record.metadata ?? {},
        created_at: record.createdAt
      })
    });

    return fromDatabaseLog(created);
  }

  async listLogs(deploymentId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.deployment_logs
        .filter((item) => item.deploymentId === deploymentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `deployment_logs?deployment_id=eq.${encodeURIComponent(deploymentId)}&select=*&order=created_at.asc`
    );
    return rows.map(fromDatabaseLog);
  }
}

function toDatabaseDeployment(record) {
  return {
    id: record.id,
    project_id: record.projectId,
    version: record.version,
    environment: record.environment,
    target: record.target,
    source: record.source ?? "Current Workspace",
    status: record.status,
    deployment_url: record.deploymentUrl ?? null,
    plan: record.plan ?? {},
    artifacts: record.artifacts ?? [],
    image_tag: record.imageTag ?? null,
    health_status: record.healthStatus ?? null,
    rollback_of: record.rollbackOf ?? null,
    created_by: record.createdById ?? null,
    created_at: record.createdAt,
    completed_at: record.completedAt ?? null
  };
}

function toDatabaseDeploymentPatch(patch) {
  const mapped = {};
  if (patch.status) mapped.status = patch.status;
  if (patch.deploymentUrl !== undefined) mapped.deployment_url = patch.deploymentUrl;
  if (patch.imageTag !== undefined) mapped.image_tag = patch.imageTag;
  if (patch.healthStatus !== undefined) mapped.health_status = patch.healthStatus;
  if (patch.rollbackOf !== undefined) mapped.rollback_of = patch.rollbackOf;
  if (patch.completedAt !== undefined) mapped.completed_at = patch.completedAt;
  if (patch.plan !== undefined) mapped.plan = patch.plan;
  if (patch.artifacts !== undefined) mapped.artifacts = patch.artifacts;
  return mapped;
}

function fromDatabaseDeployment(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    environment: row.environment,
    target: row.target,
    source: row.source,
    status: row.status,
    deploymentUrl: row.deployment_url,
    plan: row.plan,
    artifacts: row.artifacts,
    imageTag: row.image_tag,
    healthStatus: row.health_status,
    rollbackOf: row.rollback_of,
    createdById: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

function fromDatabaseLog(row) {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    level: row.level,
    phase: row.phase,
    message: row.message,
    metadata: row.metadata,
    createdAt: row.created_at
  };
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

export const deploymentRepository = new DeploymentRepository();
