import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { supabaseProjectRepository } from "./supabaseProjectRepository.mjs";

const dbPath = path.join(config.dataDir, "monitoring-alerts.json");
const emptyDb = { alerts: [] };

export class AlertsRepository {
  isConfigured() {
    return supabaseProjectRepository.isConfigured();
  }

  async create(alert) {
    const record = {
      id: alert.id ?? randomUUID(),
      projectId: required(alert.projectId ?? alert.project_id, "projectId"),
      deploymentId: alert.deploymentId ?? alert.deployment_id ?? null,
      type: normalizeAlertType(alert.type),
      severity: normalizeSeverity(alert.severity),
      title: required(alert.title, "title"),
      message: alert.message ?? "",
      status: alert.status ?? "open",
      metadata: alert.metadata ?? {},
      createdAt: alert.createdAt ?? alert.created_at ?? new Date().toISOString(),
      resolvedAt: alert.resolvedAt ?? alert.resolved_at ?? null
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.alerts = [record, ...db.alerts].slice(0, 1000);
      await writeLocalDb(db);
      return record;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest("alerts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toDatabaseAlert(record))
    });
    return fromDatabaseAlert(created);
  }

  async list(projectId, limit = 100) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.alerts
        .filter((alert) => alert.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `alerts?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc&limit=${Number(limit) || 100}`
    );
    return rows.map(fromDatabaseAlert);
  }

  async resolve(projectId, alertId) {
    const patch = { status: "resolved", resolved_at: new Date().toISOString() };
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.alerts = db.alerts.map((alert) =>
        alert.id === alertId && alert.projectId === projectId
          ? { ...alert, status: "resolved", resolvedAt: patch.resolved_at }
          : alert
      );
      await writeLocalDb(db);
      return db.alerts.find((alert) => alert.id === alertId) ?? null;
    }

    const [updated] = await supabaseProjectRepository.supabaseRequest(
      `alerts?id=eq.${encodeURIComponent(alertId)}&project_id=eq.${encodeURIComponent(projectId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch)
      }
    );
    return updated ? fromDatabaseAlert(updated) : null;
  }
}

function toDatabaseAlert(alert) {
  return {
    id: alert.id,
    project_id: alert.projectId,
    deployment_id: alert.deploymentId,
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    status: alert.status,
    metadata: alert.metadata,
    created_at: alert.createdAt,
    resolved_at: alert.resolvedAt
  };
}

function fromDatabaseAlert(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    deploymentId: row.deployment_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
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

function normalizeAlertType(value) {
  const allowed = ["High Error Rate", "Failed Deployment", "Workflow Failure", "Health Check Failure"];
  return allowed.includes(value) ? value : "Health Check Failure";
}

function normalizeSeverity(value) {
  const allowed = ["info", "warning", "critical"];
  return allowed.includes(value) ? value : "warning";
}

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

export const alertsRepository = new AlertsRepository();
