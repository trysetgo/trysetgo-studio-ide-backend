export class TXLRuntimePackager {
  package(files) {
    const txlFiles = normalizeFiles(files).filter((file) =>
      file.path.endsWith(".txl") || file.path.endsWith(".txlrules")
    );
    const parsedFiles = {};
    const errors = [];

    for (const file of txlFiles) {
      if (!file.path.endsWith(".txl")) {
        parsedFiles[file.path] = { type: "Rules", source: file.content };
        continue;
      }

      try {
        parsedFiles[file.path] = JSON.parse(file.content);
      } catch (error) {
        errors.push({
          path: file.path,
          message: error instanceof Error ? error.message : "Invalid TXL JSON."
        });
      }
    }

    const graph = compileApplicationGraph(parsedFiles);
    return {
      bundle: {
        schemaVersion: "trysetgo.runtime-bundle.v1",
        generatedAt: new Date().toISOString(),
        files: parsedFiles,
        graph,
        errors
      },
      manifest: {
        application:
          graph.application?.metadata?.name ??
          graph.application?.name ??
          "TrySetGo Application",
        version: graph.application?.metadata?.version ?? graph.application?.version ?? "1.0.0",
        entry: "app.txl",
        defaultRoute: graph.router?.defaultRoute ?? graph.routes[0]?.path ?? "/",
        routes: graph.routes,
        capabilities: {
          crud: true,
          api: true,
          workflow: true,
          permissions: true
        },
        fileCount: Object.keys(parsedFiles).length,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

function normalizeFiles(files) {
  return Array.isArray(files)
    ? files
        .filter((file) => file && typeof file.path === "string")
        .map((file) => ({
          path: toRelativePath(file.path),
          content: typeof file.content === "string" ? file.content : ""
        }))
    : [];
}

function toRelativePath(path) {
  const normalized = String(path).replace(/\\/g, "/");
  const parts = normalized.split("/");
  const appIndex = parts.findIndex((part) => part === "app.txl");
  if (appIndex > 0) {
    return parts.slice(appIndex).join("/");
  }

  if (parts.length > 1 && !["router", "layouts", "templates", "pages", "components", "apis", "workflows", "permissions", "themes", "datamodels"].includes(parts[0])) {
    return parts.slice(1).join("/");
  }

  return normalized;
}

function compileApplicationGraph(files) {
  const application = files["app.txl"] ?? null;
  const routerPath = application?.router ?? "router/routes.txl";
  const router = files[routerPath] ?? null;
  const routes = Array.isArray(router?.routes)
    ? router.routes.filter(isRecord).map((route) => ({
        path: typeof route.path === "string" ? route.path : "/",
        page: typeof route.page === "string" ? route.page : "",
        permissions: Array.isArray(route.permissions) ? route.permissions.filter(isString) : []
      })).filter((route) => route.page)
    : [];

  return {
    application,
    router,
    routes,
    layouts: collect(files, "Layout", "name"),
    templates: collect(files, "Template", "name"),
    pages: collectPages(files),
    components: collect(files, ["Component", "Grid", "Form"], "name"),
    apis: collect(files, "ApiDefinition", "name"),
    workflows: collect(files, "Workflow", "name"),
    permissions: collect(files, "Permission", "name"),
    themes: collect(files, "Theme", "name"),
    dataModels: collect(files, "DataModel", "name")
  };
}

function collect(files, types, keyField) {
  const allowed = Array.isArray(types) ? types : [types];
  return Object.fromEntries(
    Object.entries(files)
      .filter(([, source]) => isRecord(source) && allowed.includes(source.type))
      .map(([path, source]) => [source[keyField] ?? path, { path, source }])
  );
}

function collectPages(files) {
  return Object.fromEntries(
    Object.entries(files)
      .filter(([, source]) => isRecord(source) && source.type === "Page")
      .map(([path, source]) => [path, { path, source }])
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

export const txlRuntimePackager = new TXLRuntimePackager();
