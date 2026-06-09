import { runtimeVerificationService } from "../runtime/RuntimeVerificationService.mjs";
import { schemaVerificationService } from "../schema/SchemaVerificationService.mjs";

const supportedEnvironments = new Set(["DEV", "QA", "UAT", "PROD"]);
const supportedTargets = new Set(["Docker", "Google Cloud Run"]);

export class DeploymentValidationService {
  async validate({ artifacts = [], files = [], plan = {} }) {
    const issues = [];
    const environment = normalizeEnvironment(plan.environment);
    const target = plan.target ?? "Google Cloud Run";

    if (!supportedEnvironments.has(environment)) {
      issues.push(error("environment", `Unsupported environment ${plan.environment}. Use DEV, QA, UAT, or PROD.`));
    }

    if (!supportedTargets.has(target)) {
      issues.push(error("target", `Unsupported deployment target ${target}.`));
    }

    const requiredFiles = ["app.txl", "project.txl"];
    for (const requiredFile of requiredFiles) {
      if (!files.some((file) => file.path === requiredFile || file.path?.endsWith(`/${requiredFile}`))) {
        issues.push(error("files", `${requiredFile} is required for deployment.`));
      }
    }

    const schema = schemaVerificationService.verifyWorkspaceFiles({
      files,
      provider: plan.settings?.databaseType ?? "Supabase"
    });
    for (const issue of schema.issues) {
      issues.push({
        level: schema.ok ? "warning" : "error",
        code: "schema",
        message: issue.message,
        path: issue.path ?? null
      });
    }

    const runtime = await runtimeVerificationService.verify({
      files,
      provider: plan.settings?.databaseType ?? "Memory"
    });
    if (!runtime.ok) {
      for (const issue of [...(runtime.parity?.issues ?? []), ...(runtime.data?.issues ?? [])]) {
        const severity = issue.level ?? issue.severity ?? "error";
        issues.push({
          level: severity === "warning" ? "warning" : "error",
          code: issue.code ?? "runtime",
          message: issue.message,
          path: issue.path ?? null
        });
      }
    }

    const settings = plan.settings ?? {};
    const databaseType = normalizeDatabaseType(settings.databaseType);
    if (databaseType !== "Memory" && !settings.connectionString && !settings.credentialsReference && !settings.databaseUrlReference) {
      issues.push(error("secrets", `${databaseType} deployments require a database credential reference.`));
    }

    const artifactNames = new Set(artifacts.map((artifact) => artifact.path ?? artifact.name));
    for (const artifactName of ["Dockerfile", "runtime-bundle.json", "application-manifest.json"]) {
      if (!artifactNames.has(artifactName)) {
        issues.push(error("artifacts", `${artifactName} must be generated before deploy.`));
      }
    }

    return {
      ok: !issues.some((issue) => issue.level === "error"),
      issues,
      checkedAt: new Date().toISOString(),
      summary: {
        artifacts: artifacts.length,
        files: files.length,
        schema: schema.ok ? "pass" : "fail",
        runtime: runtime.ok ? "pass" : "fail",
        environment,
        target
      }
    };
  }
}

function error(code, message) {
  return { level: "error", code, message };
}

function normalizeEnvironment(value) {
  const normalized = String(value ?? "DEV").trim().toUpperCase();
  if (normalized === "DEVELOPMENT") return "DEV";
  if (normalized === "PRODUCTION") return "PROD";
  return normalized;
}

function normalizeDatabaseType(value) {
  const normalized = String(value ?? "Memory").trim().toLowerCase();
  if (normalized === "postgres" || normalized === "postgresql") return "PostgreSQL";
  if (normalized === "mysql") return "MySQL";
  if (normalized === "mongo" || normalized === "mongodb") return "MongoDB";
  if (normalized === "supabase") return "Supabase";
  return "Memory";
}

export const deploymentValidationService = new DeploymentValidationService();
