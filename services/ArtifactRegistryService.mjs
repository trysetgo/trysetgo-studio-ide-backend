import { config } from "../config.mjs";
import { commandRunner } from "./CommandRunner.mjs";

export class ArtifactRegistryService {
  getRepositoryHost() {
    return `${config.artifactRegistryLocation}-docker.pkg.dev`;
  }

  getRepositoryPath() {
    return `${this.getRepositoryHost()}/${config.gcsProjectId}/${config.artifactRegistryRepository}`;
  }

  getImageTag(applicationName, environment, version) {
    return `${this.getRepositoryPath()}/${slug(applicationName)}:${environment.toLowerCase()}-${version}`;
  }

  async ensureRepository(onLog) {
    requireGcpConfig();
    try {
      await commandRunner.run(
        "gcloud",
        [
          "artifacts",
          "repositories",
          "describe",
          config.artifactRegistryRepository,
          "--location",
          config.artifactRegistryLocation,
          "--project",
          config.gcsProjectId
        ],
        { onLog }
      );
      return;
    } catch {
      await commandRunner.run(
        "gcloud",
        [
          "artifacts",
          "repositories",
          "create",
          config.artifactRegistryRepository,
          "--repository-format",
          "docker",
          "--location",
          config.artifactRegistryLocation,
          "--project",
          config.gcsProjectId,
          "--description",
          "TrySetGo Studio deployment images"
        ],
        { onLog }
      );
    }
  }
}

function requireGcpConfig() {
  if (!config.gcsProjectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required for Cloud Run deployment.");
  }
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "trysetgo-app";
}

export const artifactRegistryService = new ArtifactRegistryService();
