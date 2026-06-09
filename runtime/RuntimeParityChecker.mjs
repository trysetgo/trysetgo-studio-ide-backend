import { runtimeBundleGenerator } from "../deployment/RuntimeBundleGenerator.mjs";

export class RuntimeParityChecker {
  compare({ files }) {
    const { bundle, manifest } = runtimeBundleGenerator.generate(files);
    const graph = bundle.graph ?? {};
    const issues = [];

    const pagePaths = new Set(Object.values(graph.pages ?? {}).map((entry) => entry.path));
    for (const route of graph.routes ?? []) {
      if (!pagePaths.has(route.page)) {
        issues.push({
          severity: "error",
          area: "routes",
          message: `Route ${route.path} references missing page ${route.page}.`
        });
      }
    }

    for (const [name, api] of Object.entries(graph.apis ?? {})) {
      const methods = api.source?.methods;
      const endpoints = api.source?.endpoints;
      if (!Array.isArray(methods) && !Array.isArray(endpoints)) {
        issues.push({
          severity: "warning",
          area: "apis",
          message: `ApiDefinition ${name} has no executable methods or endpoints.`
        });
      }
    }

    for (const [name, workflow] of Object.entries(graph.workflows ?? {})) {
      const hasSteps = Array.isArray(workflow.source?.steps) || Array.isArray(workflow.source?.nodes);
      if (!hasSteps) {
        issues.push({
          severity: "warning",
          area: "workflows",
          message: `Workflow ${name} has no executable steps.`
        });
      }
    }

    return {
      ok: issues.every((issue) => issue.severity !== "error"),
      checkedAt: new Date().toISOString(),
      manifest,
      coverage: {
        pages: Object.keys(graph.pages ?? {}).length,
        routes: (graph.routes ?? []).length,
        forms: countNodes(graph, "Form"),
        grids: countNodes(graph, "Grid"),
        apis: Object.keys(graph.apis ?? {}).length,
        workflows: Object.keys(graph.workflows ?? {}).length,
        dataModels: Object.keys(graph.dataModels ?? {}).length,
        permissions: Object.keys(graph.permissions ?? {}).length
      },
      issues
    };
  }
}

function countNodes(graph, type) {
  return Object.values(graph.pages ?? {}).reduce(
    (total, page) => total + countInTree(page.source?.children ?? [], type),
    0
  );
}

function countInTree(children, type) {
  if (!Array.isArray(children)) {
    return 0;
  }

  return children.reduce((total, child) => {
    const propsType = child?.props?.component === type ? type : null;
    return (
      total +
      (child?.type === type || propsType === type ? 1 : 0) +
      countInTree(child?.children, type)
    );
  }, 0);
}

export const runtimeParityChecker = new RuntimeParityChecker();
