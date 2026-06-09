import { runtimeBundleGenerator } from "../deployment/RuntimeBundleGenerator.mjs";
import { createProviderRegistry } from "../../runtime-server/data/ProviderRegistry.mjs";

export class DataExecutionValidator {
  async validate({ files, provider = "Memory", env = process.env }) {
    const { bundle } = runtimeBundleGenerator.generate(files);
    const providerRegistry = createProviderRegistry({
      bundle,
      env: {
        ...env,
        TRYSETGO_DATABASE_TYPE: provider
      }
    });
    const health = await providerRegistry.health();
    const results = [];

    for (const modelName of Object.keys(bundle.graph?.dataModels ?? {})) {
      results.push(await this.validateModel(providerRegistry.activeProvider, modelName));
    }

    return {
      ok: health.ok && results.every((result) => result.ok),
      provider: providerRegistry.activeProvider.name,
      health,
      results,
      queries: providerRegistry.debug().executedQueries
    };
  }

  async validateModel(provider, modelName) {
    const probe = {
      name: "TrySetGo Runtime Probe",
      status: "Validation",
      created_at: new Date().toISOString()
    };

    try {
      const created = await provider.create(modelName, probe);
      const id = created?.id;
      const listed = await provider.findAll(modelName);
      const read = id ? await provider.findById(modelName, id) : null;
      const updated = id
        ? await provider.update(modelName, id, { status: "Validated" })
        : null;
      const deleted = id ? await provider.delete(modelName, id) : null;

      return {
        ok: Boolean(created && listed && read && updated && deleted),
        modelName,
        operations: {
          create: Boolean(created),
          read: Boolean(read),
          update: Boolean(updated),
          delete: Boolean(deleted)
        }
      };
    } catch (error) {
      return {
        ok: false,
        modelName,
        error: error instanceof Error ? error.message : "Data execution validation failed."
      };
    }
  }
}

export const dataExecutionValidator = new DataExecutionValidator();
