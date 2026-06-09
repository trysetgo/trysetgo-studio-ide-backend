import { schemaVerificationService } from "../schema/SchemaVerificationService.mjs";

const allowedEnvironments = new Set(["DEV", "QA", "UAT", "PROD"]);

export class DeploymentValidationService {
  validate({ artifacts, plan, workspaceFiles }) {
    const checks = [
      this.environment(plan),
      this.secrets(plan),
      this.dependencies(artifacts),
      this.healthConfig(plan),
      this.schema(workspaceFiles, plan)
    ];

    return {
      ok: checks.every((check) => check.ok),
      checks
    };
  }

  environment(plan = {}) {
    const environment = String(plan.environment ?? "DEV").toUpperCase();
    return {
      name: "Environment Validation",
      ok: allowedEnvironments.has(environment),
      message: allowedEnvironments.has(environment)
        ? `Environment ${environment} is valid.`
        : `Unsupported deployment environment ${environment}.`
    };
  }

  secrets(plan = {}) {
    const settings = plan.settings ?? {};
    const secrets = Array.isArray(settings.secrets) ? settings.secrets : [];
    const needsDatabaseSecret =
      settings.databaseType &&
      settings.databaseType !== "Memory" &&
      !settings.connectionString;
    const ok = !needsDatabaseSecret || Boolean(settings.credentialsReference || settings.databaseUrlReference || secrets.length);
    return {
      name: "Secret Validation",
      ok,
      message: ok
        ? "Required secret references are present."
        : "Database deployments require a credential or secret reference."
    };
  }

  dependencies(artifacts = []) {
    const paths = new Set(artifacts.map((artifact) => artifact.path));
    const required = ["Dockerfile", "runtime-bundle.json", "application-manifest.json"];
    const missing = required.filter((path) => !paths.has(path));
    return {
      name: "Dependency Validation",
      ok: missing.length === 0,
      message: missing.length ? `Missing deployment artifacts: ${missing.join(", ")}.` : "Deployment artifacts are complete."
    };
  }

  healthConfig(plan = {}) {
    return {
      name: "Health Validation",
      ok: Boolean(plan.applicationName || plan.projectName),
      message: "Deployment has application identity for health reporting."
    };
  }

  schema(workspaceFiles = [], plan = {}) {
    const result = schemaVerificationService.verifyWorkspaceFiles({
      files: workspaceFiles,
      provider: plan.settings?.databaseType ?? "Supabase"
    });
    return {
      name: "Schema Verification",
      ok: result.ok,
      message: result.ok
        ? "DataModel and migration contracts are aligned."
        : result.issues.map((issue) => issue.message).join("; "),
      result
    };
  }
}

export const deploymentValidationService = new DeploymentValidationService();
