export class DeploymentHealthService {
  async check(url) {
    if (!url) {
      return { status: "unknown", ok: false, statusCode: null };
    }

    try {
      const healthUrl = new URL("/health", url).toString();
      const response = await fetch(healthUrl, { method: "GET" });
      const body = await readJson(response);
      return {
        status: response.ok && body?.status !== "degraded" ? "healthy" : "unhealthy",
        ok: response.ok && body?.status !== "degraded",
        statusCode: response.status,
        body
      };
    } catch (error) {
      return {
        status: "unreachable",
        ok: false,
        statusCode: null,
        error: error instanceof Error ? error.message : "Health check failed."
      };
    }
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export const deploymentHealthService = new DeploymentHealthService();
