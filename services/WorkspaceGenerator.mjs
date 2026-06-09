import { TXLFileGenerator } from "./TXLFileGenerator.mjs";

const DIRECTORIES = [
  "router",
  "layouts",
  "templates",
  "pages",
  "components",
  "workflows",
  "datamodels",
  "apis",
  "validations",
  "migrations",
  "permissions",
  "themes",
  "assets"
];

export class WorkspaceGenerator {
  constructor() {
    this.txlFileGenerator = new TXLFileGenerator();
  }

  generate(graph) {
    const rootName = normalizeProjectRootName(graph.appName);

    return {
      rootName,
      directories: DIRECTORIES.map((directory) => ({
        path: `${rootName}/${directory}`
      })),
      files: this.txlFileGenerator.generateFiles(graph)
    };
  }
}

function normalizeProjectRootName(value) {
  const normalized = value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 50);
  return normalized || "AIApplication";
}
