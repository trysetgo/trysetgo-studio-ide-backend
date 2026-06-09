import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";

const allowedCategories = new Set([
  "sso",
  "scim",
  "audit",
  "retention",
  "backup",
  "compliance",
  "security",
  "secrets"
]);

export class EnterpriseSettingsService {
  async get({ organizationId, category }) {
    if (!organizationId) {
      throw new Error("organizationId is required.");
    }

    if (!supabaseProjectRepository.isConfigured()) {
      return [];
    }

    const categoryFilter = category ? `&category=eq.${encodeURIComponent(category)}` : "";
    return supabaseProjectRepository.supabaseRequest(
      `enterprise_settings?organization_id=eq.${encodeURIComponent(organizationId)}${categoryFilter}&select=*&order=category.asc`
    );
  }

  async upsert({ organizationId, category, settings, user }) {
    if (!organizationId) {
      throw new Error("organizationId is required.");
    }
    if (!allowedCategories.has(category)) {
      throw new Error(`Unsupported enterprise settings category ${category}.`);
    }

    const record = {
      organization_id: organizationId,
      category,
      settings: sanitizeSettings(category, settings),
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString()
    };

    if (!supabaseProjectRepository.isConfigured()) {
      return { ...record, id: `${organizationId}:${category}` };
    }

    const [created] = await supabaseProjectRepository.supabaseRequest(
      "enterprise_settings?on_conflict=organization_id,category",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(record)
      }
    );
    return created;
  }
}

function sanitizeSettings(category, settings) {
  const value = settings && typeof settings === "object" ? settings : {};
  if (category === "sso") {
    return {
      enabled: Boolean(value.enabled),
      provider: value.provider ?? "saml",
      domains: Array.isArray(value.domains) ? value.domains : [],
      metadataUrl: value.metadataUrl ?? null,
      certificateReference: value.certificateReference ?? null
    };
  }
  if (category === "scim") {
    return {
      enabled: Boolean(value.enabled),
      endpoint: value.endpoint ?? null,
      tokenReference: value.tokenReference ?? null,
      syncGroups: Boolean(value.syncGroups)
    };
  }
  if (category === "retention") {
    return {
      auditDays: Number(value.auditDays ?? 365),
      deploymentLogDays: Number(value.deploymentLogDays ?? 90),
      snapshotDays: Number(value.snapshotDays ?? 180)
    };
  }
  if (category === "backup") {
    return {
      enabled: value.enabled !== false,
      schedule: value.schedule ?? "daily",
      retentionDays: Number(value.retentionDays ?? 30)
    };
  }
  return value;
}

export const enterpriseSettingsService = new EnterpriseSettingsService();
