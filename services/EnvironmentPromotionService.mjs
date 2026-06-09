import { deploymentService } from "./DeploymentService.mjs";

export class EnvironmentPromotionService {
  async promote({ deploymentId, environment, user }) {
    return deploymentService.promote({ deploymentId, environment, user });
  }
}

export const environmentPromotionService = new EnvironmentPromotionService();
