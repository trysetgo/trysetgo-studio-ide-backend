import { migrationHistoryRepository } from "../repositories/MigrationHistoryRepository.mjs";
import { monitoringService } from "../services/MonitoringService.mjs";

export class MigrationExecutionService {
  async apply({ migrationName, projectId, provider, script }) {
    const startedAt = performance.now();
    const history = await migrationHistoryRepository.create({
      projectId,
      migrationName,
      provider,
      status: "Running"
    });

    try {
      validateScript(script);
      const completed = await migrationHistoryRepository.update(history.id, {
        status: "Succeeded"
      });
      await this.recordMetric(projectId, provider, "success", startedAt);
      return completed;
    } catch (error) {
      const failed = await migrationHistoryRepository.update(history.id, {
        status: "Failed",
        error: error instanceof Error ? error.message : "Migration failed."
      });
      await this.recordMetric(projectId, provider, "failure", startedAt);
      return failed;
    }
  }

  async rollback({ migrationName, projectId, provider }) {
    return migrationHistoryRepository.create({
      projectId,
      migrationName,
      provider,
      status: "RolledBack",
      completedAt: new Date().toISOString()
    });
  }

  history(projectId) {
    return migrationHistoryRepository.list(projectId);
  }

  async recordMetric(projectId, provider, outcome, startedAt) {
    await monitoringService.recordMetric("workflow", {
      projectId,
      workflow: `Migration:${provider}`,
      completed: outcome === "success" ? 1 : 0,
      failed: outcome === "failure" ? 1 : 0,
      durationMs: Math.round(performance.now() - startedAt),
      metadata: { migrationOutcome: outcome }
    });
  }
}

function validateScript(script) {
  const content = String(script ?? "").trim();
  if (!content) {
    throw new Error("Migration script is required.");
  }

  if (/\bdrop\s+schema\b|\bdrop\s+database\b/i.test(content)) {
    throw new Error("Destructive database-level migration statements are blocked.");
  }
}

export const migrationExecutionService = new MigrationExecutionService();
