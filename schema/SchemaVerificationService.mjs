export class SchemaVerificationService {
  verifyWorkspaceFiles({ files, provider = "Supabase" }) {
    const txlFiles = Array.isArray(files) ? files : [];
    const dataModels = txlFiles
      .map(parseTxlFile)
      .filter((file) => file?.content?.type === "DataModel");
    const migrations = txlFiles
      .map(parseTxlFile)
      .filter((file) => file?.content?.type === "Migration");

    const issues = [];
    for (const model of dataModels) {
      const table = toTableName(model.content.name);
      const matchingMigration = migrations.find((migration) =>
        JSON.stringify(migration.content).toLowerCase().includes(table)
      );

      if (!matchingMigration) {
        issues.push({
          severity: "error",
          code: "MISSING_MIGRATION",
          message: `DataModel ${model.content.name} does not have a migration for ${table}.`,
          file: model.path,
          provider
        });
      }
    }

    return {
      ok: issues.every((issue) => issue.severity !== "error"),
      provider,
      checkedAt: new Date().toISOString(),
      dataModels: dataModels.map((model) => model.content.name),
      migrations: migrations.map((migration) => migration.content.name ?? migration.path),
      issues
    };
  }
}

function parseTxlFile(file) {
  if (!file?.path?.endsWith(".txl")) {
    return null;
  }

  try {
    return {
      path: file.path,
      content: JSON.parse(file.content ?? "{}")
    };
  } catch {
    return null;
  }
}

function toTableName(name) {
  const stem = String(name ?? "record")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return stem.endsWith("s") ? stem : `${stem}s`;
}

export const schemaVerificationService = new SchemaVerificationService();
