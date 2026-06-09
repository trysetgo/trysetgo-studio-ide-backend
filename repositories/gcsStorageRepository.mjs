import fs from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const localStorageRoot = path.join(config.dataDir, "storage");

export class GCSStorageRepository {
  constructor() {
    this.storage = config.gcsBucket
      ? new Storage({ projectId: config.gcsProjectId })
      : null;
    this.bucket = this.storage ? this.storage.bucket(config.gcsBucket) : null;
  }

  isConfigured() {
    return Boolean(this.bucket);
  }

  async createProjectFolder(projectId) {
    const markerPath = `projects/${projectId}/.keep`;
    await this.uploadFile(markerPath, "");
  }

  async uploadFile(objectPath, content) {
    if (this.isConfigured()) {
      await this.bucket.file(objectPath).save(content, {
        resumable: false,
        contentType: objectPath.endsWith(".txlrules")
          ? "text/plain"
          : "application/json"
      });
      return;
    }

    const localPath = resolveLocalObjectPath(objectPath);
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, content, "utf8");
  }

  async downloadFile(objectPath) {
    if (this.isConfigured()) {
      const [content] = await this.bucket.file(objectPath).download();
      return content.toString("utf8");
    }

    try {
      return await fs.readFile(resolveLocalObjectPath(objectPath), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new HttpError(404, "File could not be found.");
      }

      throw error;
    }
  }

  async deleteFile(objectPath) {
    if (this.isConfigured()) {
      await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
      return;
    }

    await fs.rm(resolveLocalObjectPath(objectPath), { force: true });
  }

  async deletePrefix(prefix) {
    if (!prefix) {
      return 0;
    }

    if (this.isConfigured()) {
      const [files] = await this.bucket.getFiles({ prefix });
      await Promise.all(
        files.map((file) => file.delete({ ignoreNotFound: true }))
      );
      return files.length;
    }

    const localPath = resolveLocalObjectPath(prefix);
    const files = await walkLocalFiles(localPath);
    await fs.rm(localPath, { force: true, recursive: true });
    return files.length;
  }

  async listFiles(prefix) {
    if (this.isConfigured()) {
      const [files] = await this.bucket.getFiles({ prefix });
      return Promise.all(
        files
          .filter((file) => !file.name.endsWith("/.keep"))
          .map(async (file) => ({
            path: file.name.slice(prefix.length),
            content: (await file.download())[0].toString("utf8")
          }))
      );
    }

    const root = resolveLocalObjectPath(prefix);
    const files = await walkLocalFiles(root);

    return Promise.all(
      files
        .filter((filePath) => !filePath.endsWith(`${path.sep}.keep`))
        .map(async (filePath) => ({
          path: normalizeObjectPath(path.relative(root, filePath)),
          content: await fs.readFile(filePath, "utf8")
        }))
    );
  }
}

function resolveLocalObjectPath(objectPath) {
  const resolvedPath = path.resolve(localStorageRoot, objectPath);
  if (!resolvedPath.startsWith(path.resolve(localStorageRoot))) {
    throw new HttpError(400, "Invalid storage path.");
  }

  return resolvedPath;
}

async function walkLocalFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walkLocalFiles(entryPath) : [entryPath];
      })
    );

    return files.flat();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function normalizeObjectPath(value) {
  return value.split(path.sep).join("/");
}

export const gcsStorageRepository = new GCSStorageRepository();
