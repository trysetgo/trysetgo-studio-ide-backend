import { supabaseProjectRepository } from "../repositories/supabaseProjectRepository.mjs";

const providers = new Set([
  "google-secret-manager",
  "azure-key-vault",
  "aws-secrets-manager",
  "environment"
]);

export class SecretReferenceService {
  async list({ organizationId }) {
    if (!organizationId) {
      throw new Error("organizationId is required.");
    }

    if (!supabaseProjectRepository.isConfigured()) {
      return [];
    }

    return supabaseProjectRepository.supabaseRequest(
      `secret_references?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&order=created_at.desc`
    );
  }

  async create({ organizationId, provider, name, reference, metadata = {}, user }) {
    if (!providers.has(provider)) {
      throw new Error(`Unsupported secret provider ${provider}.`);
    }
    if (!organizationId || !name || !reference) {
      throw new Error("organizationId, name, and reference are required.");
    }

    const record = {
      organization_id: organizationId,
      provider,
      name,
      reference,
      metadata,
      created_by: user?.id ?? null,
      created_at: new Date().toISOString()
    };

    if (!supabaseProjectRepository.isConfigured()) {
      return { id: `${organizationId}:${name}`, ...record };
    }

    const [created] = await supabaseProjectRepository.supabaseRequest("secret_references", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(record)
    });
    return created;
  }
}

export const secretReferenceService = new SecretReferenceService();
