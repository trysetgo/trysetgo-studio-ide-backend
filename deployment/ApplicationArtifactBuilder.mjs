import { runtimeBundleGenerator } from "./RuntimeBundleGenerator.mjs";
import { runtimeServerArtifacts } from "../../runtime-server/runtimeServerArtifacts.mjs";

export class ApplicationArtifactBuilder {
  build({ files, plan }) {
    const { bundle, manifest } = runtimeBundleGenerator.generate(files);
    const runtimeArtifacts = runtimeServerArtifacts();

    return [
      {
        path: "Dockerfile",
        language: "dockerfile",
        content: dockerfile()
      },
      {
        path: ".dockerignore",
        language: "text",
        content: ["node_modules", "npm-debug.log", ".git", ".env"].join("\n")
      },
      {
        path: "runtime-bundle.json",
        language: "json",
        content: JSON.stringify(bundle, null, 2)
      },
      {
        path: "application-manifest.json",
        language: "json",
        content: JSON.stringify({
          ...manifest,
          deployment: {
            id: plan.id,
            environment: plan.environment,
            target: plan.target,
            version: plan.version
          }
        }, null, 2)
      },
      {
        path: "environment.template",
        language: "text",
        content: environmentTemplate(plan)
      },
      ...runtimeArtifacts
    ];
  }
}

function dockerfile() {
  return [
    "FROM node:22-alpine AS runtime",
    "WORKDIR /app",
    "ENV NODE_ENV=production",
    "COPY package.json ./package.json",
    "RUN npm install --omit=dev",
    "COPY runtime-server ./runtime-server",
    "COPY runtime-bundle.json ./runtime-bundle.json",
    "COPY application-manifest.json ./application-manifest.json",
    "COPY environment.template ./environment.template",
    "EXPOSE 8080",
    "CMD [\"node\", \"runtime-server/TXLRuntimeServer.mjs\"]"
  ].join("\n");
}

function environmentTemplate(plan) {
  return [
    `TRYSETGO_APP_NAME=${plan.applicationName ?? "trysetgo-app"}`,
    `TRYSETGO_ENVIRONMENT=${plan.environment ?? "DEV"}`,
    `TRYSETGO_API_BASE_URL=${plan.settings?.apiBaseUrl ?? "/api"}`,
    `TRYSETGO_DATABASE_TYPE=${plan.settings?.databaseType ?? "Memory"}`,
    `TRYSETGO_DATABASE_URL_REFERENCE=${plan.settings?.credentialsReference ?? plan.settings?.databaseUrlReference ?? "DATABASE_URL"}`,
    "DATABASE_URL=<set-by-cloud-run-secret-or-environment>",
    "SUPABASE_URL=<set-for-supabase-provider>",
    "SUPABASE_SERVICE_ROLE_KEY=<set-by-cloud-run-secret>",
    "PORT=8080"
  ].join("\n");
}

export const applicationArtifactBuilder = new ApplicationArtifactBuilder();
