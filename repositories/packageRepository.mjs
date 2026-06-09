import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { gcsStorageRepository } from "./gcsStorageRepository.mjs";
import { supabaseProjectRepository } from "./supabaseProjectRepository.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "packages.json");
const emptyDb = {
  packages: [],
  package_installs: []
};

export class PackageRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async list({ query, type } = {}) {
    const packages = this.isConfigured()
      ? await this.supabaseRequest("packages?select=*&order=updated_at.desc")
      : (await readLocalDb()).packages;

    return packages
      .filter((item) => !type || item.type === type)
      .filter((item) => {
        if (!query) return true;
        const haystack = `${item.name} ${item.description} ${item.author} ${item.type}`.toLowerCase();
        return haystack.includes(String(query).toLowerCase());
      })
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }

  async get(packageId) {
    const metadata = await this.getMetadata(packageId);
    if (!metadata) {
      throw new HttpError(404, "Package could not be found.");
    }

    return {
      ...metadata,
      bundle: await this.getBundle(metadata)
    };
  }

  async publish({ body, user }) {
    const manifest = normalizeManifest(body.manifest ?? body.package ?? body);
    const files = normalizeFiles(body.files);
    const now = new Date().toISOString();
    const packageId = packageKey(manifest.name, manifest.version);
    const storagePath = `packages/${encodeURIComponent(manifest.name)}/${encodeURIComponent(manifest.version)}/package-bundle.json`;
    const metadata = {
      id: packageId,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      type: manifest.type,
      dependencies: manifest.dependencies,
      storage_path: storagePath,
      published_by: user?.id ?? null,
      published_by_email: user?.email ?? null,
      created_at: now,
      updated_at: now
    };
    const bundle = {
      manifest,
      files,
      publishedAt: now,
      publishedBy: user?.email ?? user?.id ?? "unknown"
    };

    await gcsStorageRepository.uploadFile(storagePath, JSON.stringify(bundle, null, 2));

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.packages = [metadata, ...db.packages.filter((item) => item.id !== packageId)];
      await writeLocalDb(db);
      return { ...metadata, bundle };
    }

    const [published] = await this.supabaseRequest("packages?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(metadata)
    });

    return { ...published, bundle };
  }

  async install({ packageId, projectId, user }) {
    const pkg = await this.get(packageId);
    const files = normalizeFiles(pkg.bundle?.files);

    if (projectId) {
      await Promise.all(
        files.map((file) =>
          gcsStorageRepository.uploadFile(`projects/${projectId}/${file.path}`, file.content)
        )
      );
      await supabaseProjectRepository.registerProjectFiles(
        projectId,
        files.map((file) => ({
          path: file.path,
          storagePath: `projects/${projectId}/${file.path}`,
          contentType: file.path.endsWith(".txlrules") ? "text/plain" : "application/json",
          sizeBytes: Buffer.byteLength(file.content)
        }))
      );
    }

    const install = {
      id: randomUUID(),
      package_id: packageId,
      package_name: pkg.name,
      package_version: pkg.version,
      project_id: projectId ?? null,
      installed_by: user?.id ?? null,
      installed_by_email: user?.email ?? null,
      installed_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.package_installs = [install, ...db.package_installs];
      await writeLocalDb(db);
    } else {
      await this.supabaseRequest("package_installs", {
        method: "POST",
        body: JSON.stringify(install)
      });
    }

    return {
      package: withoutBundle(pkg),
      install,
      files
    };
  }

  async removeInstall({ packageId, projectId, user }) {
    if (!projectId) {
      throw new HttpError(400, "projectId is required.");
    }

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.package_installs = db.package_installs.filter(
        (install) => !(install.project_id === projectId && install.package_id === packageId)
      );
      await writeLocalDb(db);
    } else {
      await this.supabaseRequest(
        `package_installs?project_id=eq.${encodeURIComponent(projectId)}&package_id=eq.${encodeURIComponent(packageId)}`,
        { method: "DELETE" }
      );
    }

    return {
      packageId,
      projectId,
      removedBy: user?.email ?? user?.id ?? null,
      removedAt: new Date().toISOString()
    };
  }

  async getMetadata(packageId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.packages.find((item) => item.id === packageId || item.name === packageId) ?? null;
    }

    const records = await this.supabaseRequest(
      `packages?or=(id.eq.${encodeURIComponent(packageId)},name.eq.${encodeURIComponent(packageId)})&select=*&limit=1`
    );
    return records[0] ?? null;
  }

  async getBundle(metadata) {
    const content = await gcsStorageRepository.downloadFile(metadata.storage_path);
    return JSON.parse(content);
  }

  async supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${pathname}`, {
      ...init,
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
        "Accept-Profile": config.supabaseSchema,
        "Content-Profile": config.supabaseSchema,
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }

    if (response.status === 204) return [];
    return response.json();
  }
}

async function readLocalDb() {
  try {
    return { ...emptyDb, ...JSON.parse(await fs.readFile(dbPath, "utf8")) };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { ...emptyDb };
  }
}

async function writeLocalDb(db) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

function normalizeManifest(value) {
  const manifest = {
    name: requireText(value.name, "Package name"),
    version: requireText(value.version ?? "1.0.0", "Package version"),
    author: requireText(value.author ?? "TrySetGo", "Package author"),
    dependencies: Array.isArray(value.dependencies) ? value.dependencies.filter((item) => typeof item === "string") : [],
    description: typeof value.description === "string" ? value.description : "",
    type: normalizeType(value.type)
  };
  return manifest;
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files
    .filter((file) => file && typeof file.path === "string")
    .filter((file) => file.path.endsWith(".txl") || file.path.endsWith(".txlrules"))
    .map((file) => ({
      path: normalizePath(file.path),
      content: typeof file.content === "string" ? file.content : ""
    }));
}

function normalizeType(type) {
  const normalized = String(type ?? "Module").trim();
  const allowed = ["Application", "Module", "Component", "Workflow", "Theme", "Data Model"];
  return allowed.includes(normalized) ? normalized : "Module";
}

function normalizePath(value) {
  return String(value).replace(/\\/g, "/").replace(/^\/+/, "");
}

function packageKey(name, version) {
  return `${name}@${version}`;
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${label} is required.`);
  }
  return value.trim();
}

function withoutBundle(pkg) {
  const { bundle, ...metadata } = pkg;
  return metadata;
}

export const packageRepository = new PackageRepository();
