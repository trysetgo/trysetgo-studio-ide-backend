import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(backendDir, "..");

loadEnvFile(path.join(projectRoot, ".env"));

export const config = {
  port: Number(process.env.PORT ?? process.env.TRYSETGO_API_PORT ?? 8787),
  host: process.env.TRYSETGO_API_HOST ?? "0.0.0.0",
  allowedOrigins: (
    process.env.TRYSETGO_ALLOWED_ORIGINS ??
    process.env.TRYSETGO_ALLOWED_ORIGIN ??
    "http://127.0.0.1:5173,http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  dataDir: process.env.TRYSETGO_DATA_DIR ?? path.join(backendDir, ".data"),
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ""),
  supabaseSchema: process.env.SUPABASE_SCHEMA ?? "trysetgo",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceKey:
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY,
  defaultOrganizationName:
    process.env.TRYSETGO_DEFAULT_ORGANIZATION_NAME ?? "TrySetGo",
  defaultOrganizationSlug:
    process.env.TRYSETGO_DEFAULT_ORGANIZATION_SLUG ?? "trysetgo",
  defaultOrganizationId:
    process.env.TRYSETGO_DEFAULT_ORGANIZATION_ID ??
    process.env.VITE_DEFAULT_ORGANIZATION_ID ??
    "00000000-0000-4000-8000-000000000001",
  openAiApiKey: readOptionalEnv("OPENAI_API_KEY"),
  openAiModel: readOptionalEnv("OPENAI_MODEL") ?? "gpt-5",
  aiArchitectMode: readOptionalEnv("AI_ARCHITECT_MODE") ?? "openai",
  openAiTimeoutMs: Number(readOptionalEnv("OPENAI_TIMEOUT_MS") ?? 45000),
  openAiFallbackOnTimeout:
    (readOptionalEnv("OPENAI_FALLBACK_ON_TIMEOUT") ?? "true") === "true",
  gcsBucket: process.env.GCS_BUCKET,
  gcsProjectId: process.env.GOOGLE_CLOUD_PROJECT,
  cloudRunRegion: process.env.CLOUD_RUN_REGION ?? "us-central1",
  artifactRegistryLocation:
    process.env.ARTIFACT_REGISTRY_LOCATION ??
    process.env.CLOUD_RUN_REGION ??
    "us-central1",
  artifactRegistryRepository:
    process.env.ARTIFACT_REGISTRY_REPOSITORY ?? "trysetgo-studio",
  deploymentExecutionMode:
    process.env.DEPLOYMENT_EXECUTION_MODE ?? "gcloud",
  githubToken: readOptionalEnv("GITHUB_TOKEN")
};

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function readOptionalEnv(key) {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}
