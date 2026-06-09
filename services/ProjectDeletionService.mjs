import { gcsStorageRepository } from "../repositories/gcsStorageRepository.mjs";
import { rbacRepository } from "../repositories/rbacRepository.mjs";
import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";
import { HttpError } from "../utils/http.mjs";

export class ProjectDeletionService {
  async deleteProject({ projectId, user }) {
    const project = await supabaseProjectRepository.getProject(projectId);
    if (!project) {
      throw new HttpError(404, "Project could not be found.");
    }

    await rbacRepository.recordAuditEvent({
      action: "Project.DeleteStarted",
      projectId,
      user,
      metadata: {
        name: project.name,
        storagePath: project.storage_path
      }
    });

    await supabaseProjectRepository.updateProject(projectId, {
      status: "deleting",
      updated_at: new Date().toISOString()
    });

    const storagePrefixes = uniqueStoragePrefixes(project);
    const storageDeleted = {};
    for (const prefix of storagePrefixes) {
      storageDeleted[prefix] = await gcsStorageRepository.deletePrefix(prefix);
    }

    await rbacRepository.recordAuditEvent({
      action: "Project.StorageDeleted",
      projectId,
      user,
      metadata: {
        prefixes: storagePrefixes,
        deletedObjects: storageDeleted
      }
    });

    const databaseDeleted = await supabaseProjectRepository.deleteProject(projectId);

    await rbacRepository.recordAuditEvent({
      action: "Project.DatabaseDeleted",
      user,
      metadata: {
        deletedProjectId: projectId,
        deletedRows: databaseDeleted
      }
    });

    await rbacRepository.recordAuditEvent({
      action: "Project.Deleted",
      user,
      metadata: {
        deletedProjectId: projectId,
        name: project.name,
        storagePrefixes,
        storageDeleted,
        databaseDeleted
      }
    });

    return {
      project: {
        id: project.id,
        name: project.name,
        organizationId: project.organization_id,
        storagePath: project.storage_path
      },
      status: "deleted",
      storage: {
        prefixes: storagePrefixes,
        deletedObjects: storageDeleted
      },
      database: databaseDeleted
    };
  }
}

function uniqueStoragePrefixes(project) {
  const prefixes = [
    project.storage_path,
    project.organization_id
      ? `organizations/${project.organization_id}/projects/${project.id}/`
      : null,
    `projects/${project.id}/`
  ]
    .filter((value) => typeof value === "string" && value.length > 0)
    .map((value) => value.endsWith("/") ? value : `${value}/`);

  return Array.from(new Set(prefixes));
}

export const projectDeletionService = new ProjectDeletionService();
