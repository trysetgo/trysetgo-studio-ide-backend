import { alertsRepository } from "../repositories/alertsRepository.mjs";
import { deploymentRepository } from "../repositories/deploymentRepository.mjs";
import { metricsRepository } from "../repositories/metricsRepository.mjs";

export class MonitoringService {
  async dashboard(projectId) {
    const [applicationMetrics, apiMetrics, workflowMetrics, deploymentMetrics, deployments, alerts] =
      await Promise.all([
        metricsRepository.listApplicationMetrics(projectId),
        metricsRepository.listApiMetrics(projectId),
        metricsRepository.listWorkflowMetrics(projectId),
        metricsRepository.listDeploymentMetrics(projectId),
        deploymentRepository.listDeployments(projectId),
        alertsRepository.list(projectId)
      ]);

    return {
      health: this.applicationHealth({ applicationMetrics, apiMetrics, workflowMetrics, deployments, alerts }),
      application: summarizeApplication(applicationMetrics),
      apis: summarizeApis(apiMetrics),
      workflows: summarizeWorkflows(workflowMetrics),
      deployments: summarizeDeployments(deployments, deploymentMetrics),
      alerts
    };
  }

  async health(projectId) {
    const dashboard = await this.dashboard(projectId);
    return dashboard.health;
  }

  async apiMetrics(projectId) {
    return summarizeApis(await metricsRepository.listApiMetrics(projectId));
  }

  async workflowMetrics(projectId) {
    return summarizeWorkflows(await metricsRepository.listWorkflowMetrics(projectId));
  }

  async deploymentMetrics(projectId) {
    const [deployments, metrics] = await Promise.all([
      deploymentRepository.listDeployments(projectId),
      metricsRepository.listDeploymentMetrics(projectId)
    ]);
    return summarizeDeployments(deployments, metrics);
  }

  async alerts(projectId) {
    return alertsRepository.list(projectId);
  }

  async recordMetric(kind, metric) {
    if (kind === "application") return metricsRepository.recordApplicationMetric(metric);
    if (kind === "api") return metricsRepository.recordApiMetric(metric);
    if (kind === "workflow") return metricsRepository.recordWorkflowMetric(metric);
    if (kind === "deployment") return metricsRepository.recordDeploymentMetric(metric);
    throw new Error("Unsupported metric kind.");
  }

  async createAlert(alert) {
    return alertsRepository.create(alert);
  }

  applicationHealth({ applicationMetrics, apiMetrics, workflowMetrics, deployments, alerts }) {
    const openCritical = alerts.some((alert) => alert.status === "open" && alert.severity === "critical");
    const lastDeployment = deployments[0] ?? null;
    const errorRate = calculateErrorRate([
      ...applicationMetrics,
      ...apiMetrics.map((metric) => ({
        requestCount: metric.requestCount,
        errorCount: metric.failureCount || metric.errorCount
      }))
    ]);
    const workflowFailures = sum(workflowMetrics, "failed");

    if (openCritical || lastDeployment?.healthStatus === "unhealthy" || errorRate >= 0.2) {
      return {
        status: "critical",
        errorRate,
        message: "Critical operational issue detected."
      };
    }

    if (lastDeployment?.status === "Failed" || workflowFailures > 0 || errorRate >= 0.05) {
      return {
        status: "degraded",
        errorRate,
        message: "Application is running with warnings."
      };
    }

    return {
      status: "healthy",
      errorRate,
      message: "Application health is nominal."
    };
  }
}

function summarizeApplication(metrics) {
  return {
    requests: sum(metrics, "requestCount"),
    responses: sum(metrics, "responseCount"),
    errors: sum(metrics, "errorCount"),
    latency: average(metrics, "latencyMs"),
    activeUsers: Math.max(0, ...metrics.map((metric) => Number(metric.activeUsers ?? 0)))
  };
}

function summarizeApis(metrics) {
  const groups = groupBy(metrics, (metric) => `${metric.method ?? "GET"} ${metric.endpoint ?? metric.name ?? "unknown"}`);
  return Object.entries(groups).map(([key, rows]) => ({
    key,
    endpoint: rows[0]?.endpoint ?? "unknown",
    method: rows[0]?.method ?? "GET",
    requestCount: sum(rows, "requestCount"),
    successCount: sum(rows, "successCount"),
    failureCount: sum(rows, "failureCount"),
    averageLatency: average(rows, "latencyMs")
  }));
}

function summarizeWorkflows(metrics) {
  const groups = groupBy(metrics, (metric) => metric.workflow ?? metric.name ?? "Workflow");
  return Object.entries(groups).map(([workflow, rows]) => ({
    workflow,
    instances: sum(rows, "instances"),
    completed: sum(rows, "completed"),
    failed: sum(rows, "failed"),
    pendingApprovals: sum(rows, "pendingApprovals"),
    averageDuration: average(rows, "durationMs")
  }));
}

function summarizeDeployments(deployments, metrics) {
  const lastSuccessful = deployments.find((deployment) => deployment.status === "Succeeded") ?? null;
  return {
    deployments: deployments.length || sum(metrics, "deployments"),
    rollbacks: deployments.filter((deployment) => deployment.rollbackOf).length || sum(metrics, "rollbacks"),
    promotions: deployments.filter((deployment) => deployment.source === "Promotion").length || sum(metrics, "promotions"),
    healthStatus: deployments[0]?.healthStatus ?? "unknown",
    lastSuccessfulDeployment: lastSuccessful,
    recent: deployments.slice(0, 10)
  };
}

function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = getKey(item);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
}

function average(items, key) {
  const values = items.map((item) => Number(item[key] ?? 0)).filter((value) => value > 0);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function calculateErrorRate(metrics) {
  const requests = sum(metrics, "requestCount");
  if (requests === 0) return 0;
  return Number((sum(metrics, "errorCount") / requests).toFixed(4));
}

export const monitoringService = new MonitoringService();
