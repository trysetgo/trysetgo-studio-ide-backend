import { randomUUID } from "node:crypto";
import { gcsStorageRepository } from "../repositories/gcsStorageRepository.mjs";
import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";

export class BackupRecoveryService {
  async createProjectBackup({ projectId, reason = "manual", user }) {
    const project = await supabaseProjectRepository.getProject(projectId);
    if (!project) {
      throw new Error("Project could not be found.");
    }

    const prefix = project.storage_path ?? `projects/${projectId}/`;
    const files = await gcsStorageRepository.listFiles(prefix);
    const backupId = randomUUID();
    const backupPath = `backups/${project.organization_id}/${projectId}/${backupId}.json`;
    const payload = {
      id: backupId,
      project,
      files,
      reason,
      createdBy: user?.id ?? null,
      createdAt: new Date().toISOString()
    };

    await gcsStorageRepository.uploadFile(backupPath, JSON.stringify(payload, null, 2));
    await this.recordJob({
      id: backupId,
      organizationId: project.organization_id,
      projectId,
      status: "Succeeded",
      backupPath,
      createdBy: user?.id ?? null,
      completedAt: new Date().toISOString()
    });

    return {
      backupId,
      backupPath,
      files: files.length,
      projectId,
      createdAt: payload.createdAt
    };
  }

  async restoreProjectBackup({ projectId, backupPath, user }) {
    const project = await supabaseProjectRepository.getProject(projectId);
    if (!project) {
      throw new Error("Project could not be found.");
    }

    const backup = JSON.parse(await gcsStorageRepository.downloadFile(backupPath));
    if (backup.project?.id !== projectId) {
      throw new Error("Backup does not belong to the requested project.");
    }

    const prefix = project.storage_path ?? `projects/${projectId}/`;
    await gcsStorageRepository.deletePrefix(prefix);
    for (const file of backup.files ?? []) {
      await gcsStorageRepository.uploadFile(`${prefix}${file.path}`, file.content ?? "");
    }

    const restoreId = randomUUID();
    await this.recordJob({
      id: restoreId,
      organizationId: project.organization_id,
      projectId,
      status: "Restored",
      backupPath,
      createdBy: user?.id ?? null,
      completedAt: new Date().toISOString()
    });

    return {
      restoreId,
      projectId,
      restoredFiles: backup.files?.length ?? 0,
      backupPath
    };
  }

  async recordJob(record) {
    if (!supabaseProjectRepository.isConfigured()) {
      return record;
    }

    const [created] = await supabaseProjectRepository.supabaseRequest("backup_jobs", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        id: record.id,
        organization_id: record.organizationId,
        project_id: record.projectId,
        status: record.status,
        backup_path: record.backupPath,
        created_by: record.createdBy,
        created_at: new Date().toISOString(),
        completed_at: record.completedAt,
        error: record.error ?? null
      })
    });
    return created;
  }
}

export const backupRecoveryService = new BackupRecoveryService();
