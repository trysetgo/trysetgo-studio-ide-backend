import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { supabaseProjectRepository } from "./supabaseProjectRepository.mjs";

const dbPath = path.join(config.dataDir, "monitoring-metrics.json");
const emptyDb = {
  application_metrics: [],
  api_metrics: [],
  workflow_metrics: [],
  deployment_metrics: []
};

export class MetricsRepository {
  isConfigured() {
    return supabaseProjectRepository.isConfigured();
  }

  async recordApplicationMetric(metric) {
    return this.insert("application_metrics", normalizeMetric(metric));
  }

  async recordApiMetric(metric) {
    return this.insert("api_metrics", normalizeMetric(metric));
  }

  async recordWorkflowMetric(metric) {
    return this.insert("workflow_metrics", normalizeMetric(metric));
  }

  async recordDeploymentMetric(metric) {
    return this.insert("deployment_metrics", normalizeMetric(metric));
  }

  async listApplicationMetrics(projectId, limit = 500) {
    return this.list("application_metrics", projectId, limit);
  }

  async listApiMetrics(projectId, limit = 500) {
    return this.list("api_metrics", projectId, limit);
  }

  async listWorkflowMetrics(projectId, limit = 500) {
    return this.list("workflow_metrics", projectId, limit);
  }

  async listDeploymentMetrics(projectId, limit = 500) {
    return this.list("deployment_metrics", projectId, limit);
  }

  async insert(table, metric) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db[table] = [metric, ...(db[table] ?? [])].slice(0, 2000);
      await writeLocalDb(db);
      return metric;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toDatabaseMetric(metric, table))
    });

    return fromDatabaseMetric(created);
  }

  async list(table, projectId, limit) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return (db[table] ?? [])
        .filter((metric) => metric.projectId === projectId)
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
        .slice(0, limit);
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `${table}?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=recorded_at.desc&limit=${Number(limit) || 500}`
    );
    return rows.map(fromDatabaseMetric);
  }
}

function normalizeMetric(metric) {
  return {
    id: metric.id ?? randomUUID(),
    projectId: required(metric.projectId ?? metric.project_id, "projectId"),
    deploymentId: metric.deploymentId ?? metric.deployment_id ?? null,
    environment: metric.environment ?? null,
    name: metric.name ?? null,
    endpoint: metric.endpoint ?? null,
    method: metric.method ?? null,
    workflow: metric.workflow ?? null,
    requestCount: Number(metric.requestCount ?? metric.request_count ?? 0),
    responseCount: Number(metric.responseCount ?? metric.response_count ?? 0),
    errorCount: Number(metric.errorCount ?? metric.error_count ?? 0),
    successCount: Number(metric.successCount ?? metric.success_count ?? 0),
    failureCount: Number(metric.failureCount ?? metric.failure_count ?? 0),
    latencyMs: Number(metric.latencyMs ?? metric.latency_ms ?? 0),
    activeUsers: Number(metric.activeUsers ?? metric.active_users ?? 0),
    instances: Number(metric.instances ?? 0),
    completed: Number(metric.completed ?? 0),
    failed: Number(metric.failed ?? 0),
    pendingApprovals: Number(metric.pendingApprovals ?? metric.pending_approvals ?? 0),
    durationMs: Number(metric.durationMs ?? metric.duration_ms ?? 0),
    deployments: Number(metric.deployments ?? 0),
    rollbacks: Number(metric.rollbacks ?? 0),
    promotions: Number(metric.promotions ?? 0),
    healthStatus: metric.healthStatus ?? metric.health_status ?? null,
    metadata: metric.metadata ?? {},
    recordedAt: metric.recordedAt ?? metric.recorded_at ?? new Date().toISOString()
  };
}

function toDatabaseMetric(metric, table) {
  const base = {
    id: metric.id,
    project_id: metric.projectId,
    deployment_id: metric.deploymentId,
    environment: metric.environment,
    metadata: metric.metadata,
    recorded_at: metric.recordedAt
  };

  if (table === "application_metrics") {
    return {
      ...base,
      name: metric.name,
      request_count: metric.requestCount,
      response_count: metric.responseCount,
      error_count: metric.errorCount,
      latency_ms: metric.latencyMs,
      active_users: metric.activeUsers
    };
  }

  if (table === "api_metrics") {
    return {
      ...base,
      endpoint: metric.endpoint ?? metric.name ?? "unknown",
      method: metric.method ?? "GET",
      request_count: metric.requestCount,
      success_count: metric.successCount,
      failure_count: metric.failureCount,
      error_count: metric.errorCount,
      latency_ms: metric.latencyMs
    };
  }

  if (table === "workflow_metrics") {
    return {
      ...base,
      workflow: metric.workflow ?? metric.name ?? "Workflow",
      instances: metric.instances,
      completed: metric.completed,
      failed: metric.failed,
      pending_approvals: metric.pendingApprovals,
      duration_ms: metric.durationMs
    };
  }

  if (table === "deployment_metrics") {
    return {
      ...base,
      deployments: metric.deployments,
      rollbacks: metric.rollbacks,
      promotions: metric.promotions,
      health_status: metric.healthStatus
    };
  }

  return base;
}

function fromDatabaseMetric(row) {
  return normalizeMetric(row);
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

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

export const metricsRepository = new MetricsRepository();
