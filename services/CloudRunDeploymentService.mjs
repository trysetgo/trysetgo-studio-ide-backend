import { config } from "../config.mjs";
import { commandRunner } from "./CommandRunner.mjs";

export class CloudRunDeploymentService {
  async deploy({ serviceName, imageTag, environment, envVars, secrets, onLog }) {
    if (config.deploymentExecutionMode !== "gcloud") {
      return {
        url: `https://${serviceName}-${environment.toLowerCase()}.run.app`,
        skipped: true
      };
    }

    const args = [
      "run",
      "deploy",
      serviceName,
      "--image",
      imageTag,
      "--platform",
      "managed",
      "--region",
      config.cloudRunRegion,
      "--project",
      config.gcsProjectId,
      "--allow-unauthenticated",
      "--port",
      "8080",
      "--quiet",
      "--format",
      "value(status.url)"
    ];

    const envArg = toEnvVars(envVars);
    if (envArg) {
      args.push("--set-env-vars", envArg);
    }

    const secretArg = toSecrets(secrets);
    if (secretArg) {
      args.push("--set-secrets", secretArg);
    }

    const result = await commandRunner.run("gcloud", args, { onLog });
    const url = result.stdout.trim().split(/\r?\n/).at(-1)?.trim();
    return {
      url,
      skipped: false
    };
  }

  async rollback({ serviceName, revision, onLog }) {
    if (config.deploymentExecutionMode !== "gcloud") {
      return { skipped: true };
    }

    await commandRunner.run(
      "gcloud",
      [
        "run",
        "services",
        "update-traffic",
        serviceName,
        "--to-revisions",
        `${revision}=100`,
        "--region",
        config.cloudRunRegion,
        "--project",
        config.gcsProjectId,
        "--quiet"
      ],
      { onLog }
    );
    return { skipped: false };
  }
}

function toEnvVars(envVars = {}) {
  return Object.entries(envVars)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value).replace(/,/g, "\\,")}`)
    .join(",");
}

function toSecrets(secrets = []) {
  return secrets
    .filter(Boolean)
    .map((secret) => `${secret}=${secret}:latest`)
    .join(",");
}

export const cloudRunDeploymentService = new CloudRunDeploymentService();
