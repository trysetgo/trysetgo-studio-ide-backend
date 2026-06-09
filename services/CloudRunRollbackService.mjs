import { cloudRunDeploymentService } from "./CloudRunDeploymentService.mjs";

export class CloudRunRollbackService {
  async rollbackToImage({ serviceName, imageTag, environment, envVars, secrets, onLog }) {
    return cloudRunDeploymentService.deploy({
      serviceName,
      imageTag,
      environment,
      envVars,
      secrets,
      onLog
    });
  }

  async rollbackToRevision({ serviceName, revision, onLog }) {
    return cloudRunDeploymentService.rollback({ serviceName, revision, onLog });
  }
}

export const cloudRunRollbackService = new CloudRunRollbackService();
