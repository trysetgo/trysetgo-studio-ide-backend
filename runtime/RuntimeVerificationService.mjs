import { dataExecutionValidator } from "./DataExecutionValidator.mjs";
import { runtimeParityChecker } from "./RuntimeParityChecker.mjs";

export class RuntimeVerificationService {
  async verify({ files, provider = "Memory" }) {
    const parity = runtimeParityChecker.compare({ files });
    const data = await dataExecutionValidator.validate({ files, provider });

    return {
      ok: parity.ok && data.ok,
      checkedAt: new Date().toISOString(),
      parity,
      data,
      score: score(parity, data)
    };
  }
}

function score(parity, data) {
  const checks = [
    parity.ok,
    data.health?.ok,
    data.results.every((result) => result.operations?.create),
    data.results.every((result) => result.operations?.read),
    data.results.every((result) => result.operations?.update),
    data.results.every((result) => result.operations?.delete)
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export const runtimeVerificationService = new RuntimeVerificationService();
