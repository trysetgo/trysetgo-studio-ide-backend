import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const dbPath = path.join(config.dataDir, "organization-members.json");
const emptyDb = { organization_members: [] };

export class OrganizationMemberRepository {
  isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseServiceKey);
  }

  async listForUser(user) {
    if (!user?.id && !user?.email) {
      return [];
    }

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      return db.organization_members.filter((member) =>
        member.user_id === user.id ||
        (member.user_email && member.user_email === user.email?.toLowerCase())
      );
    }

    const filters = [`user_id.eq.${encodeURIComponent(user.id)}`];
    if (user.email) {
      filters.push(`user_email.eq.${encodeURIComponent(user.email.toLowerCase())}`);
    }

    return this.supabaseRequest(
      `organization_members?or=(${filters.join(",")})&select=*`
    );
  }

  async listOrganizationIdsForUser(user) {
    const memberships = await this.listForUser(user);
    return Array.from(
      new Set(
        memberships
          .map((membership) => membership.organization_id)
          .filter((value) => typeof value === "string" && value.length > 0)
      )
    );
  }

  async hasMembership(user, organizationId) {
    if (!organizationId) {
      return false;
    }

    const memberships = await this.listForUser(user);
    return memberships.some(
      (membership) => membership.organization_id === organizationId
    );
  }

  async upsertMember({ organizationId, role = "Member", userEmail, userId }) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      organization_id: required(organizationId, "organizationId"),
      user_id: userId ?? null,
      user_email: userEmail?.toLowerCase() ?? null,
      role,
      created_at: now,
      updated_at: now
    };

    if (!record.user_id && !record.user_email) {
      throw new HttpError(400, "Organization member user_id or user_email is required.");
    }

    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.organization_members = [
        record,
        ...db.organization_members.filter(
          (member) =>
            !(
              member.organization_id === record.organization_id &&
              ((record.user_id && member.user_id === record.user_id) ||
                (record.user_email && member.user_email === record.user_email))
            )
        )
      ];
      await writeLocalDb(db);
      return record;
    }

    const conflictTarget = record.user_id
      ? "organization_id,user_id"
      : "organization_id,user_email";
    const [created] = await this.supabaseRequest(
      `organization_members?on_conflict=${conflictTarget}`,
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      }
    );

    return created;
  }

  async removeMember({ organizationId, userId, userEmail }) {
    if (!this.isConfigured()) {
      const db = await readLocalDb();
      db.organization_members = db.organization_members.filter(
        (member) =>
          !(
            member.organization_id === organizationId &&
            ((userId && member.user_id === userId) ||
              (userEmail && member.user_email === userEmail.toLowerCase()))
          )
      );
      await writeLocalDb(db);
      return;
    }

    const filters = [`organization_id=eq.${encodeURIComponent(organizationId)}`];
    if (userId) filters.push(`user_id=eq.${encodeURIComponent(userId)}`);
    if (userEmail) filters.push(`user_email=eq.${encodeURIComponent(userEmail.toLowerCase())}`);
    await this.supabaseRequest(`organization_members?${filters.join("&")}`, {
      method: "DELETE"
    });
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

function required(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${label} is required.`);
  }
  return value.trim();
}

export const organizationMemberRepository = new OrganizationMemberRepository();
