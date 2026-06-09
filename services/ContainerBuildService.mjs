import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.mjs";
import { commandRunner } from "./CommandRunner.mjs";

export class ContainerBuildService {
  async buildAndPush({ artifacts, imageTag, deploymentId, onLog }) {
    if (config.deploymentExecutionMode !== "gcloud") {
      onLog?.(`Deployment execution mode is ${config.deploymentExecutionMode}; skipping real build.`, "warning");
      return { imageTag, skipped: true };
    }

    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `trysetgo-deploy-${deploymentId}-`));
    try {
      await writeArtifacts(workspace, artifacts);
      await commandRunner.run(
        "gcloud",
        [
          "builds",
          "submit",
          workspace,
          "--tag",
          imageTag,
          "--project",
          config.gcsProjectId,
          "--quiet"
        ],
        { onLog }
      );
      return { imageTag, skipped: false };
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
}

async function writeArtifacts(workspace, artifacts) {
  for (const artifact of artifacts) {
    const target = path.resolve(workspace, artifact.path);
    if (!target.startsWith(workspace)) {
      throw new Error(`Invalid artifact path: ${artifact.path}`);
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, artifact.content ?? "", "utf8");
  }
}

export const containerBuildService = new ContainerBuildService();
