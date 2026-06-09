import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "project-admin.json");

const emptyDb = {
  project_members: [],
  git_credentials: []
};

export class ProjectAdminRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async listMembers(projectId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.project_members.filter((member) => member.project_id === projectId);
    }

    return this.supabaseRequest(
      `project_members?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.asc`
    );
  }

  async upsertMember({ projectId, role, userEmail, userId }) {
    const record = {
      id: randomUUID(),
      project_id: projectId,
      user_id: userId || stableUuid(userEmail),
      user_email: userEmail,
      role,
      created_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_members = [
        ...db.project_members.filter(
          (member) =>
            member.project_id !== projectId ||
            normalizeEmail(member.user_email) !== normalizeEmail(userEmail)
        ),
        record
      ];
      await writeLocalDb(db);
      return record;
    }

    const [created] = await this.supabaseRequest("project_members?on_conflict=project_id,user_email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(record)
    });

    return created;
  }

  async findAuthUserByEmail(email) {
    if (!this.isConfigured()) {
      return null;
    }

    const normalizedEmail = normalizeEmail(email);
    const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users?per_page=1000`, {
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`
      }
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const users = Array.isArray(payload.users) ? payload.users : [];
    const user = users.find(
      (candidate) => normalizeEmail(candidate.email) === normalizedEmail
    );

    return user
      ? {
          id: user.id,
          email: user.email
        }
      : null;
  }

  async updateMemberRole(projectId, memberId, role) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      const current = db.project_members.find((member) => member.id === memberId && member.project_id === projectId);
      if (!current) {
        throw new HttpError(404, "Project member could not be found.");
      }

      const updated = { ...current, role };
      db.project_members = db.project_members.map((member) =>
        member.id === memberId ? updated : member
      );
      await writeLocalDb(db);
      return updated;
    }

    const [updated] = await this.supabaseRequest(
      `project_members?id=eq.${encodeURIComponent(memberId)}&project_id=eq.${encodeURIComponent(projectId)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ role })
      }
    );

    if (!updated) {
      throw new HttpError(404, "Project member could not be found.");
    }

    return updated;
  }

  async removeMember(projectId, memberId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.project_members = db.project_members.filter(
        (member) => !(member.id === memberId && member.project_id === projectId)
      );
      await writeLocalDb(db);
      return;
    }

    await this.supabaseRequest(
      `project_members?id=eq.${encodeURIComponent(memberId)}&project_id=eq.${encodeURIComponent(projectId)}`,
      { method: "DELETE" }
    );
  }

  async listCredentials(organizationId) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.git_credentials
        .filter((credential) => credential.organization_id === organizationId)
        .map(withoutSecret);
    }

    return this.supabaseRequest(
      `git_credentials?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,organization_id,provider,name,created_by,created_at&order=created_at.desc`
    );
  }

  async createCredential({ createdBy, name, organizationId, provider, secret }) {
    const record = {
      id: randomUUID(),
      organization_id: organizationId,
      provider,
      name,
      encrypted_secret: encryptSecret(secret),
      created_by: createdBy,
      created_at: new Date().toISOString()
    };

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.git_credentials = [record, ...db.git_credentials];
      await writeLocalDb(db);
      return withoutSecret(record);
    }

    const [created] = await this.supabaseRequest("git_credentials", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(record)
    });

    return withoutSecret(created);
  }

  async listAuditLogs(projectId) {
    if (!this.isConfigured()) {
      return [];
    }

    return this.supabaseRequest(
      `audit_logs?project_id=eq.${encodeURIComponent(projectId)}&select=*&order=created_at.desc&limit=100`
    );
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

    if (response.status === 204) {
      return [];
    }

    return response.json();
  }
}

async function readLocalDb() {
  try {
    const content = await fs.readFile(dbPath, "utf8");
    return { ...emptyDb, ...JSON.parse(content) };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return { ...emptyDb };
  }
}

async function writeLocalDb(db) {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

function encryptSecret(secret) {
  const key = createHash("sha256")
    .update(process.env.TRYSETGO_SECRET_ENCRYPTION_KEY ?? config.supabaseServiceKey ?? "local-dev-key")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function stableUuid(value) {
  const hash = createHash("sha256").update(normalizeEmail(value)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function withoutSecret(credential) {
  const { encrypted_secret, ...safeCredential } = credential;
  return safeCredential;
}

export const projectAdminRepository = new ProjectAdminRepository();
