import { randomUUID } from "node:crypto";
import { applicationArtifactBuilder } from "../deployment/ApplicationArtifactBuilder.mjs";
import { activityRepository } from "../repositories/activityRepository.mjs";
import { deploymentRepository } from "../repositories/deploymentRepository.mjs";
import { rbacRepository } from "../repositories/rbacRepository.mjs";
import { artifactRegistryService } from "./ArtifactRegistryService.mjs";
import { cloudRunDeploymentService } from "./CloudRunDeploymentService.mjs";
import { cloudRunRollbackService } from "./CloudRunRollbackService.mjs";
import { containerBuildService } from "./ContainerBuildService.mjs";
import { deploymentHealthService } from "./DeploymentHealthService.mjs";
import { deploymentOperationsRepository } from "../repositories/deploymentOperationsRepository.mjs";
import { deploymentValidationService } from "./DeploymentValidationService.mjs";
import { monitoringService } from "./MonitoringService.mjs";

export class DeploymentService {
  async deploy({ body, user }) {
    const plan = body.plan ?? {};
    const workspaceFiles = Array.isArray(body.workspaceFiles) ? body.workspaceFiles : [];
    const artifacts = workspaceFiles.length
      ? applicationArtifactBuilder.build({ files: workspaceFiles, plan })
      : Array.isArray(body.artifacts) ? body.artifacts : [];
    const projectId = requireString(body.projectId ?? plan.projectId, "projectId");
    const deploymentId = body.deploymentId ?? plan.id ?? randomUUID();
    const environment = normalizeEnvironment(plan.environment ?? body.environment ?? "DEV");
    const applicationName = plan.applicationName ?? body.applicationName ?? "trysetgo-app";
    const version = String(plan.version ?? body.version ?? "1");
    const target = plan.target ?? "Google Cloud Run";
    const serviceName = plan.cloudRunService ?? slug(applicationName);
    const imageTag = artifactRegistryService.getImageTag(applicationName, environment, version);
    const validation = await deploymentValidationService.validate({ artifacts, files: workspaceFiles, plan: { ...plan, environment, target } });
    if (!validation.ok) {
      throw new Error(
        `Deployment validation failed: ${validation.issues
          .filter((issue) => issue.level === "error")
          .map((issue) => issue.message)
          .join("; ")}`
      );
    }
    const record = await deploymentRepository.createDeployment({
      id: deploymentId,
      projectId,
      version,
      environment,
      target,
      source: plan.source ?? "Current Workspace",
      status: "Queued",
      createdAt: new Date().toISOString(),
      createdById: user.id,
      plan,
      artifacts,
      imageTag
    });
    await deploymentOperationsRepository.recordArtifacts({ deploymentId, projectId, artifacts });
    await deploymentOperationsRepository.upsertEnvironment({
      projectId,
      name: environment,
      status: "active",
      variables: deploymentEnvVars(plan, applicationName, environment),
      secrets: { references: deploymentSecrets(plan) }
    });

    await this.log(projectId, deploymentId, "info", "Queued", "Deployment queued.", { user: user.email });
    await this.log(projectId, deploymentId, "info", "Validate", "Deployment validation passed.", validation.summary);
    await rbacRepository.recordAuditEvent({
      action: "Deployment.Started",
      projectId,
      user,
      metadata: { deploymentId, environment, imageTag }
    });
    await activityRepository.record({
      action: "Deployment Started",
      entityId: deploymentId,
      entityType: "deployment",
      metadata: { environment, imageTag },
      projectId,
      user
    });
    await monitoringService.recordMetric("deployment", {
      projectId,
      deploymentId,
      environment,
      deployments: 1,
      healthStatus: "queued",
      metadata: { imageTag, status: "Queued" }
    });

    try {
      await deploymentRepository.updateDeployment(deploymentId, { status: "Building", imageTag });
      await rbacRepository.recordAuditEvent({
        action: "Deployment.Building",
        projectId,
        user,
        metadata: { deploymentId, imageTag }
      });
      await this.log(projectId, deploymentId, "info", "Building", "Ensuring Artifact Registry repository.");
      await artifactRegistryService.ensureRepository((message, level) =>
        this.log(projectId, deploymentId, level, "Building", message)
      );

      await this.log(projectId, deploymentId, "info", "Building", `Building and pushing ${imageTag}.`);
      await containerBuildService.buildAndPush({
        artifacts,
        imageTag,
        deploymentId,
        onLog: (message, level) => this.log(projectId, deploymentId, level, "Building", message)
      });

      await deploymentRepository.updateDeployment(deploymentId, { status: "Deploying", imageTag });
      await rbacRepository.recordAuditEvent({
        action: "Deployment.Deploying",
        projectId,
        user,
        metadata: { deploymentId, imageTag }
      });
      await this.log(projectId, deploymentId, "info", "Deploying", `Deploying ${serviceName} to Cloud Run.`);
      const deployed = await cloudRunDeploymentService.deploy({
        serviceName,
        imageTag,
        environment,
        envVars: deploymentEnvVars(plan, applicationName, environment),
        secrets: deploymentSecrets(plan),
        onLog: (message, level) => this.log(projectId, deploymentId, level, "Deploying", message)
      });
      await deploymentOperationsRepository.recordRevision({
        deploymentId,
        projectId,
        environment,
        imageTag,
        revisionName: deployed.revision ?? null,
        trafficPercent: 100,
        status: "active"
      });

      const health = await deploymentHealthService.check(deployed.url);
      await this.log(projectId, deploymentId, health.ok ? "info" : "warning", "Runtime", `Health status: ${health.status}.`, health);
      const completed = await deploymentRepository.updateDeployment(deploymentId, {
        status: health.ok ? "Succeeded" : "Failed",
        deploymentUrl: deployed.url,
        imageTag,
        healthStatus: health.status,
        completedAt: new Date().toISOString()
      });
      await rbacRepository.recordAuditEvent({
        action: health.ok ? "Deployment.Succeeded" : "Deployment.Failed",
        projectId,
        user,
        metadata: { deploymentId, imageTag, url: deployed.url, health }
      });
      await activityRepository.record({
        action: health.ok ? "Deployment Succeeded" : "Deployment Failed",
        entityId: deploymentId,
        entityType: "deployment",
        metadata: { environment, imageTag, url: deployed.url, healthStatus: health.status },
        projectId,
        user
      });
      await monitoringService.recordMetric("deployment", {
        projectId,
        deploymentId,
        environment,
        deployments: 1,
        healthStatus: health.status,
        metadata: { imageTag, url: deployed.url, status: completed?.status ?? "Unknown" }
      });
      if (!health.ok) {
        await monitoringService.createAlert({
          projectId,
          deploymentId,
          type: "Health Check Failure",
          severity: "critical",
          title: "Deployment health check failed",
          message: `Deployment ${deploymentId} reported ${health.status}.`,
          metadata: { health, url: deployed.url }
        });
      }
      return {
        deployment: completed,
        logs: await deploymentRepository.listLogs(deploymentId)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deployment failed.";
      await deploymentRepository.updateDeployment(deploymentId, {
        status: "Failed",
        completedAt: new Date().toISOString()
      });
      await this.log(projectId, deploymentId, "error", "Deploying", message);
      await rbacRepository.recordAuditEvent({
        action: "Deployment.Failed",
        projectId,
        user,
        metadata: { deploymentId, imageTag, error: message }
      });
      await activityRepository.record({
        action: "Deployment Failed",
        entityId: deploymentId,
        entityType: "deployment",
        metadata: { environment, imageTag, error: message },
        projectId,
        user
      });
      await monitoringService.recordMetric("deployment", {
        projectId,
        deploymentId,
        environment,
        deployments: 1,
        healthStatus: "failed",
        metadata: { imageTag, error: message }
      });
      await monitoringService.createAlert({
        projectId,
        deploymentId,
        type: "Failed Deployment",
        severity: "critical",
        title: "Deployment failed",
        message,
        metadata: { imageTag, environment }
      });
      throw error;
    }
  }

  async list(projectId) {
    return {
      deployments: await deploymentRepository.listDeployments(projectId)
    };
  }

  async status(deploymentId) {
    const deployment = await deploymentRepository.getDeployment(deploymentId);
    return {
      deployment,
      logs: await deploymentRepository.listLogs(deploymentId)
    };
  }

  async rollback({ deploymentId, user }) {
    const deployment = await deploymentRepository.getDeployment(deploymentId);
    if (!deployment) {
      throw new Error("Deployment could not be found.");
    }

    const previous = await this.findPreviousSuccessfulDeployment(deployment);
    if (!previous?.imageTag) {
      throw new Error("No previous successful image tag is available for rollback.");
    }

    const serviceName = deployment.plan?.cloudRunService ?? slug(deployment.plan?.applicationName ?? "trysetgo-app");
    await this.log(deployment.projectId, deploymentId, "warning", "Deploying", `Rollback requested to ${previous.imageTag}.`);
    await cloudRunRollbackService.rollbackToImage({
      serviceName,
      imageTag: previous.imageTag,
      environment: deployment.environment,
      envVars: deploymentEnvVars(deployment.plan, deployment.plan?.applicationName ?? "trysetgo-app", deployment.environment),
      secrets: deploymentSecrets(deployment.plan),
      onLog: (message, level) => this.log(deployment.projectId, deploymentId, level, "Deploying", message)
    });
    await deploymentOperationsRepository.recordRevision({
      deploymentId,
      projectId: deployment.projectId,
      environment: deployment.environment,
      imageTag: previous.imageTag,
      revisionName: null,
      trafficPercent: 100,
      status: "rollback"
    });
    await deploymentRepository.updateDeployment(deploymentId, {
      status: "Succeeded",
      imageTag: previous.imageTag,
      rollbackOf: previous.id,
      completedAt: new Date().toISOString()
    });
    await rbacRepository.recordAuditEvent({
      action: "Deployment.Rollback",
      projectId: deployment.projectId,
      user,
      metadata: { deploymentId, rollbackTarget: previous.id, imageTag: previous.imageTag }
    });
    await activityRepository.record({
      action: "Deployment Rollback",
      entityId: deploymentId,
      entityType: "deployment",
      metadata: { rollbackTarget: previous.id, imageTag: previous.imageTag },
      projectId: deployment.projectId,
      user
    });
    await monitoringService.recordMetric("deployment", {
      projectId: deployment.projectId,
      deploymentId,
      environment: deployment.environment,
      rollbacks: 1,
      healthStatus: "rollback",
      metadata: { rollbackTarget: previous.id, imageTag: previous.imageTag }
    });

    return {
      deployment: await deploymentRepository.getDeployment(deploymentId),
      logs: await deploymentRepository.listLogs(deploymentId)
    };
  }

  async promote({ deploymentId, environment, user }) {
    const deployment = await deploymentRepository.getDeployment(deploymentId);
    if (!deployment?.imageTag) {
      throw new Error("Deployment image tag is required for promotion.");
    }

    const promotedId = randomUUID();
    const targetEnvironment = normalizeEnvironment(environment);
    const serviceName = `${deployment.plan?.cloudRunService ?? slug(deployment.plan?.applicationName ?? "trysetgo-app")}-${targetEnvironment.toLowerCase()}`;
    const record = await deploymentRepository.createDeployment({
      ...deployment,
      id: promotedId,
      environment: targetEnvironment,
      status: "Deploying",
      source: "Promotion",
      rollbackOf: deployment.id,
      createdAt: new Date().toISOString(),
      completedAt: null,
      createdById: user.id
    });
    await this.log(deployment.projectId, promotedId, "info", "Deploying", `Promoting ${deployment.imageTag} to ${targetEnvironment}.`);
    const deployed = await cloudRunDeploymentService.deploy({
      serviceName,
      imageTag: deployment.imageTag,
      environment: targetEnvironment,
      envVars: deploymentEnvVars(deployment.plan, deployment.plan?.applicationName ?? "trysetgo-app", targetEnvironment),
      secrets: deploymentSecrets(deployment.plan),
      onLog: (message, level) => this.log(deployment.projectId, promotedId, level, "Deploying", message)
    });
    await deploymentOperationsRepository.recordRevision({
      deploymentId: promotedId,
      projectId: deployment.projectId,
      environment: targetEnvironment,
      imageTag: deployment.imageTag,
      revisionName: deployed.revision ?? null,
      trafficPercent: 100,
      status: "promoted"
    });
    const health = await deploymentHealthService.check(deployed.url);
    const completed = await deploymentRepository.updateDeployment(promotedId, {
      status: health.ok ? "Succeeded" : "Failed",
      deploymentUrl: deployed.url,
      healthStatus: health.status,
      completedAt: new Date().toISOString()
    });
    await rbacRepository.recordAuditEvent({
      action: "Deployment.Promoted",
      projectId: deployment.projectId,
      user,
      metadata: { sourceDeploymentId: deploymentId, promotedId, environment: targetEnvironment, imageTag: deployment.imageTag }
    });
    await activityRepository.record({
      action: "Deployment Promoted",
      entityId: promotedId,
      entityType: "deployment",
      metadata: { sourceDeploymentId: deploymentId, environment: targetEnvironment, imageTag: deployment.imageTag },
      projectId: deployment.projectId,
      user
    });
    await monitoringService.recordMetric("deployment", {
      projectId: deployment.projectId,
      deploymentId: promotedId,
      environment: targetEnvironment,
      promotions: 1,
      healthStatus: health.status,
      metadata: { sourceDeploymentId: deploymentId, imageTag: deployment.imageTag }
    });
    return {
      deployment: completed ?? record,
      logs: await deploymentRepository.listLogs(promotedId)
    };
  }

  async log(projectId, deploymentId, level, phase, message, metadata = {}) {
    return deploymentRepository.addLog({
      deploymentId,
      projectId,
      level: normalizeLevel(level),
      phase,
      message: String(message).trim(),
      metadata
    });
  }

  async findPreviousSuccessfulDeployment(deployment) {
    const deployments = await deploymentRepository.listDeployments(deployment.projectId);
    return deployments.find((candidate) =>
      candidate.id !== deployment.id &&
      candidate.status === "Succeeded" &&
      candidate.environment === deployment.environment &&
      candidate.imageTag
    );
  }
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }

  return value.trim();
}

function normalizeLevel(level) {
  return level === "error" || level === "warning" ? level : "info";
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "trysetgo-app";
}

function normalizeEnvironment(value) {
  const normalized = String(value).trim().toUpperCase();
  if (normalized === "DEVELOPMENT") return "DEV";
  if (normalized === "PRODUCTION") return "PROD";
  if (["DEV", "QA", "UAT", "PROD"].includes(normalized)) return normalized;
  return "DEV";
}

function deploymentEnvVars(plan = {}, applicationName = "trysetgo-app", environment = "DEV") {
  const settings = plan.settings ?? {};
  const credentialsReference = settings.credentialsReference ?? settings.databaseUrlReference ?? "DATABASE_URL";
  const envVars = {
    TRYSETGO_APP_NAME: applicationName,
    TRYSETGO_ENVIRONMENT: environment,
    TRYSETGO_API_BASE_URL: settings.apiBaseUrl ?? "/api",
    TRYSETGO_DATABASE_TYPE: normalizeDatabaseType(settings.databaseType),
    TRYSETGO_DATABASE_URL_REFERENCE: credentialsReference,
    TRYSETGO_DATABASE_NAME: settings.databaseName ?? ""
  };

  if (settings.connectionString) {
    envVars[credentialsReference] = settings.connectionString;
  }

  return envVars;
}

function deploymentSecrets(plan = {}) {
  const settings = plan.settings ?? {};
  const secrets = Array.isArray(settings.secrets) ? [...settings.secrets] : [];
  const databaseType = normalizeDatabaseType(settings.databaseType);
  const shouldAttachDatabaseSecret = databaseType !== "Memory" && !settings.connectionString;

  if (shouldAttachDatabaseSecret) {
    secrets.push(settings.credentialsReference ?? settings.databaseUrlReference ?? "DATABASE_URL");
  }

  return Array.from(new Set(secrets.filter(Boolean)));
}

function normalizeDatabaseType(value) {
  const normalized = String(value ?? "Memory").trim().toLowerCase();
  if (normalized === "postgresql") return "PostgreSQL";
  if (normalized === "postgres") return "PostgreSQL";
  if (normalized === "mysql") return "MySQL";
  if (normalized === "mongo" || normalized === "mongodb") return "MongoDB";
  if (normalized === "supabase") return "Supabase";
  return "Memory";
}

export const deploymentService = new DeploymentService();
