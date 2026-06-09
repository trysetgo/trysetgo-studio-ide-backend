import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";
import { ApplicationGraphGenerator } from "./ApplicationGraphGenerator.mjs";
import { WorkspaceGenerator } from "./WorkspaceGenerator.mjs";

const supportedKinds = [
  "CRM",
  "CMS",
  "E-Commerce",
  "Admin Dashboard",
  "Knowledge Portal",
  "Healthcare Portal"
];

export class AIArchitectService {
  constructor() {
    this.fallbackGraphGenerator = new ApplicationGraphGenerator();
    this.workspaceGenerator = new WorkspaceGenerator();
  }

  async generateApplication(prompt) {
    const graph = await this.generateGraph(prompt);
    const normalizedGraph = normalizeGraph(graph, prompt);
    const structure = this.workspaceGenerator.generate(normalizedGraph);

    return {
      form: {
        projectName: normalizedGraph.appName,
        projectType: toProjectType(normalizedGraph.kind),
        template: toTemplate(normalizedGraph.kind),
        theme: "Modern",
        description: prompt.trim()
      },
      graph: normalizedGraph,
      structure
    };
  }

  async generateGraph(prompt) {
    if (config.aiArchitectMode === "deterministic" || !config.openAiApiKey) {
      return this.fallbackGraphGenerator.generate(prompt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.openAiTimeoutMs);
    let response;

    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.openAiApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: config.openAiModel,
          reasoning: { effort: "medium" },
          max_output_tokens: 6000,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: createSystemPrompt()
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: prompt
                }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "txl_application_graph",
              strict: false,
              schema: createGraphSchema()
            }
          }
        })
      });
    } catch (error) {
      if (error.name === "AbortError") {
        if (config.openAiFallbackOnTimeout) {
          return this.fallbackGraphGenerator.generate(prompt);
        }

        throw new HttpError(504, "OpenAI application generation timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }

    const payload = await response.json();
    const text = extractResponseText(payload);

    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(502, "OpenAI returned an invalid application graph.");
    }
  }
}

function createGraphSchema() {
  return {
    type: "object",
    additionalProperties: true,
    required: [
      "appName",
      "kind",
      "description",
      "modules",
      "dataModels",
      "apis",
      "workflows",
      "permissions"
    ],
    properties: {
      appName: { type: "string" },
      kind: { type: "string", enum: supportedKinds },
      description: { type: "string" },
      modules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            name: { type: "string" },
            route: { type: "string" },
            title: { type: "string" },
            permissions: { type: "array", items: { type: "string" } },
            dataModel: { type: "string" },
            api: { type: "string" },
            workflow: { type: "string" }
          }
        }
      },
      dataModels: { type: "array", items: { type: "object" } },
      apis: { type: "array", items: { type: "object" } },
      workflows: { type: "array", items: { type: "object" } },
      permissions: { type: "array", items: { type: "object" } }
    }
  };
}

function createSystemPrompt() {
  return `You are the TrySetGo Studio AI Architect.
Generate a complete application graph for TXL, the TrySetGo Experience Language.

Hard rules:
- Return JSON only.
- Never generate React.
- Never generate HTML.
- Never generate CSS or JavaScript.
- Generate TXL application architecture concepts only.
- Supported kinds: ${supportedKinds.join(", ")}.

Required JSON shape:
{
  "appName": "CRM Platform",
  "kind": "CRM",
  "description": "string",
  "modules": [
    {
      "name": "Customers",
      "route": "/customers",
      "title": "Customers",
      "permissions": ["Customer.Read"],
      "dataModel": "Customer",
      "api": "CustomersApi",
      "workflow": "ApprovalWorkflow"
    }
  ],
  "dataModels": [
    {
      "name": "Customer",
      "fields": [
        { "name": "id", "type": "uuid" },
        { "name": "name", "type": "string" }
      ]
    }
  ],
  "apis": [
    {
      "name": "CustomersApi",
      "baseUrl": "/api/customers",
      "methods": ["GET", "POST", "PUT", "DELETE"]
    }
  ],
  "workflows": [
    {
      "name": "ApprovalWorkflow",
      "steps": ["Draft", "Review", "Approve", "Notify"]
    }
  ],
  "permissions": [
    {
      "name": "Customer.Read",
      "description": "View customer records"
    }
  ]
}`;
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const content = payload.output
    ?.flatMap((item) => item.content ?? [])
    ?.find((item) => item.type === "output_text" || item.text);

  return content?.text ?? "";
}

function normalizeGraph(graph, prompt) {
  const fallback = new ApplicationGraphGenerator().generate(prompt);
  const kind = supportedKinds.includes(graph.kind) ? graph.kind : fallback.kind;
  const modules = Array.isArray(graph.modules) && graph.modules.length > 0
    ? graph.modules
    : fallback.modules;

  return {
    appName: ensureString(graph.appName, fallback.appName),
    kind,
    description: ensureString(graph.description, prompt.trim()),
    modules: modules.map((module) => ({
      name: ensureString(module.name, "Module"),
      route: ensureRoute(module.route, module.name),
      title: ensureString(module.title, module.name ?? "Module"),
      permissions: ensureStringArray(module.permissions, ["Application.Access"]),
      dataModel: optionalString(module.dataModel),
      api: optionalString(module.api),
      workflow: optionalString(module.workflow)
    })),
    dataModels: ensureArray(graph.dataModels, fallback.dataModels),
    apis: ensureArray(graph.apis, fallback.apis),
    workflows: ensureArray(graph.workflows, fallback.workflows),
    permissions: ensureArray(graph.permissions, fallback.permissions)
  };
}

function ensureString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function ensureStringArray(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

function ensureArray(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

function ensureRoute(route, name) {
  if (typeof route === "string" && route.startsWith("/")) {
    return route;
  }

  return `/${String(name ?? "module")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()}`;
}

function toProjectType(kind) {
  if (kind === "E-Commerce") return "E-Commerce";
  if (kind === "Admin Dashboard") return "Dashboard";
  if (kind === "CRM") return "Enterprise Portal";
  return "Website";
}

function toTemplate(kind) {
  if (kind === "E-Commerce") return "E-Commerce";
  if (kind === "CRM") return "Enterprise";
  return "SaaS";
}

export const aiArchitectService = new AIArchitectService();
