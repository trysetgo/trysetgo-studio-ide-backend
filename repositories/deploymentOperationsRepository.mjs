import { createHash, randomUUID } from "node:crypto";
import { supabaseProjectRepository } from "./supabaseProjectRepository.mjs";

export class DeploymentOperationsRepository {
  isConfigured() {
    return supabaseProjectRepository.isConfigured();
  }

  async recordArtifacts({ deploymentId, projectId, artifacts = [] }) {
    const records = artifacts.map((artifact) => {
      const content = typeof artifact.content === "string" ? artifact.content : JSON.stringify(artifact.content ?? "");
      return {
        id: randomUUID(),
        deploymentId,
        projectId,
        path: artifact.path ?? artifact.name,
        contentType: artifact.contentType ?? inferContentType(artifact.path ?? artifact.name),
        sizeBytes: Buffer.byteLength(content),
        checksum: createHash("sha256").update(content).digest("hex"),
        storagePath: artifact.storagePath ?? null,
        createdAt: new Date().toISOString()
      };
    });

    if (records.length === 0) {
      return [];
    }

    if (!this.isConfigured()) {
      return records;
    }

    const created = await supabaseProjectRepository.supabaseRequest("deployment_artifacts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(records.map(toDatabaseArtifact))
    });
    return created.map(fromDatabaseArtifact);
  }

  async listArtifacts(deploymentId) {
    if (!this.isConfigured()) {
      return [];
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `deployment_artifacts?deployment_id=eq.${encodeURIComponent(deploymentId)}&select=*&order=created_at.asc`
    );
    return rows.map(fromDatabaseArtifact);
  }

  async recordRevision({ deploymentId, projectId, environment, imageTag, revisionName, trafficPercent = 100, status }) {
    const record = {
      id: randomUUID(),
      deploymentId,
      projectId,
      environment,
      imageTag,
      revisionName: revisionName ?? null,
      trafficPercent,
      status,
      createdAt: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      return record;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest("deployment_revisions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(toDatabaseRevision(record))
    });
    return fromDatabaseRevision(created);
  }

  async listRevisions(deploymentId) {
    if (!this.isConfigured()) {
      return [];
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `deployment_revisions?deployment_id=eq.${encodeURIComponent(deploymentId)}&select=*&order=created_at.desc`
    );
    return rows.map(fromDatabaseRevision);
  }

  async upsertEnvironment({ projectId, name, status = "active", variables = {}, secrets = {} }) {
    const record = {
      project_id: projectId,
      name,
      status,
      variables,
      secrets,
      updated_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      return { projectId, name, status, variables, secrets };
    }

    const [created] = await supabaseProjectRepository.supabaseRequest(
      "deployment_environments?on_conflict=project_id,name",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      }
    );
    return fromDatabaseEnvironment(created);
  }

  async listEnvironments(projectId) {
    if (!this.isConfigured()) {
      return [];
    }

    const rows = await supabaseProjectRepository.supabaseRequest(
      `deployment_environments?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=name.asc`
    );
    return rows.map(fromDatabaseEnvironment);
  }
}

function inferContentType(filePath = "") {
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith("Dockerfile") || filePath.endsWith(".dockerignore")) return "text/plain";
  return "text/plain";
}

function toDatabaseArtifact(record) {
  return {
    id: record.id,
    deployment_id: record.deploymentId,
    project_id: record.projectId,
    path: record.path,
    content_type: record.contentType,
    size_bytes: record.sizeBytes,
    checksum: record.checksum,
    storage_path: record.storagePath,
    created_at: record.createdAt
  };
}

function fromDatabaseArtifact(row) {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    path: row.path,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    storagePath: row.storage_path,
    createdAt: row.created_at
  };
}

function toDatabaseRevision(record) {
  return {
    id: record.id,
    deployment_id: record.deploymentId,
    project_id: record.projectId,
    environment: record.environment,
    image_tag: record.imageTag,
    revision_name: record.revisionName,
    traffic_percent: record.trafficPercent,
    status: record.status,
    created_at: record.createdAt
  };
}

function fromDatabaseRevision(row) {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    projectId: row.project_id,
    environment: row.environment,
    imageTag: row.image_tag,
    revisionName: row.revision_name,
    trafficPercent: row.traffic_percent,
    status: row.status,
    createdAt: row.created_at
  };
}

function fromDatabaseEnvironment(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    variables: row.variables ?? {},
    secrets: row.secrets ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export const deploymentOperationsRepository = new DeploymentOperationsRepository();
