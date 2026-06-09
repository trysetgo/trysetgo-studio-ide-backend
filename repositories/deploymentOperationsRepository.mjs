import { randomUUID } from "node:crypto";
import { supabaseProjectRepository } from "./supabaseProjectRepository.mjs";

export class DeploymentOperationsRepository {
  isConfigured() {
    return supabaseProjectRepository.isConfigured();
  }

  async recordArtifacts({ artifacts, deploymentId, projectId }) {
    const records = artifacts.map((artifact) => ({
      id: randomUUID(),
      deployment_id: deploymentId,
      project_id: projectId,
      path: artifact.path,
      content_type: artifact.language ?? "text",
      size_bytes: Buffer.byteLength(artifact.content ?? ""),
      created_at: new Date().toISOString()
    }));

    if (!this.isConfigured() || records.length === 0) {
      return records;
    }

    return supabaseProjectRepository.supabaseRequest("deployment_artifacts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(records)
    });
  }

  async recordRevision({ deployment, revision, trafficPercent = 100 }) {
    const record = {
      id: randomUUID(),
      deployment_id: deployment.id,
      project_id: deployment.projectId,
      environment: deployment.environment,
      image_tag: deployment.imageTag,
      revision,
      traffic_percent: trafficPercent,
      status: deployment.status,
      created_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      return record;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest("deployment_revisions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(record)
    });
    return created;
  }

  async upsertEnvironment({ environment, projectId, settings = {} }) {
    const record = {
      id: `${projectId}:${environment}`,
      project_id: projectId,
      environment,
      settings,
      updated_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      return record;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest(
      "deployment_environments?on_conflict=id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      }
    );
    return created;
  }
}

export const deploymentOperationsRepository = new DeploymentOperationsRepository();
