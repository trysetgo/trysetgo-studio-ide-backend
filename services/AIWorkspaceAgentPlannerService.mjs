import { config } from "../config.mjs";
import { HttpError } from "../utils/http.mjs";

const supportedTools = [
  "createFile",
  "updateFile",
  "deleteFile",
  "renameFile",
  "duplicateFile",
  "createPage",
  "createLayout",
  "createWorkflow",
  "createApi",
  "createDataModel",
  "createPermission",
  "createRoute",
  "generateCrud",
  "generateApi",
  "generateMigration",
  "createEndpoint",
  "updateEndpoint",
  "deleteEndpoint"
];

export class AIWorkspaceAgentPlannerService {
  async plan({ context, prompt, tools }) {
    if (config.aiArchitectMode === "deterministic" || !config.openAiApiKey) {
      return createDeterministicPlan(prompt);
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
          max_output_tokens: 3500,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: createSystemPrompt(tools)
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify(
                    {
                      prompt,
                      workspaceContext: compactContext(context)
                    },
                    null,
                    2
                  )
                }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "txl_workspace_agent_plan",
              strict: false,
              schema: createPlanSchema()
            }
          }
        })
      });
    } catch (error) {
      if (error.name === "AbortError") {
        if (config.openAiFallbackOnTimeout) {
          return createDeterministicPlan(prompt);
        }

        throw new HttpError(504, "OpenAI workspace agent planning timed out.");
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
      return normalizePlan(JSON.parse(text));
    } catch {
      throw new HttpError(502, "OpenAI returned an invalid workspace agent plan.");
    }
  }
}

function createSystemPrompt(tools) {
  return `You are the TrySetGo Studio AI Workspace Agent planner.
Return JSON only. Never generate React, HTML, CSS, JavaScript, TypeScript, or JSX.
You may only return tool calls from this list: ${supportedTools.join(", ")}.
Do not mutate files directly. Do not include prose outside JSON.

Workspace tools available to you:
${JSON.stringify(tools ?? [], null, 2)}

Planning rules:
- Prefer high-level tools like createPage, createApi, createDataModel, createPermission, createWorkflow, generateMigration, and createRoute.
- Use valid TXL concepts only.
- Use existing layouts and permissions from context when appropriate.
- For pages, include route, title, layout, template, and permissions.
- For createRoute, path is an application route like "/employees"; page is a relative TXL path like "pages/employees.txl".
- Return concise tool calls that can be validated by the client.`;
}

function createPlanSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "toolCalls"],
    properties: {
      summary: { type: "string" },
      toolCalls: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tool", "input"],
          properties: {
            tool: { type: "string", enum: supportedTools },
            input: { type: "object", additionalProperties: true }
          }
        }
      }
    }
  };
}

function compactContext(context) {
  if (!context) {
    return null;
  }

  return {
    project: context.project,
    activeFile: {
      filePath: context.activeFile?.filePath,
      fileName: context.activeFile?.fileName
    },
    openTabs: context.openTabs,
    symbols: {
      layouts: context.symbols?.layouts,
      pages: context.symbols?.pages,
      workflows: context.symbols?.workflows,
      apis: context.symbols?.apis,
      datamodels: context.symbols?.datamodels,
      migrations: context.symbols?.migrations,
      permissions: context.symbols?.permissions,
      themes: context.symbols?.themes
    },
    diagnostics: context.diagnostics,
    applicationGraph: {
      routes: context.applicationGraph?.routes,
      defaultRoute: context.applicationGraph?.defaultRoute,
      pageCount: Object.keys(context.applicationGraph?.pages ?? {}).length,
      layoutNames: Object.keys(context.applicationGraph?.layouts ?? {}),
      workflowNames: Object.keys(context.applicationGraph?.workflows ?? {}),
      apiNames: Object.keys(context.applicationGraph?.apis ?? {}),
      dataModelNames: Object.keys(context.applicationGraph?.dataModels ?? {}),
      permissionNames: Object.keys(context.applicationGraph?.permissions ?? {})
    },
    explorerTree: compactTree(context.explorerTree)
  };
}

function compactTree(node) {
  if (!node) {
    return null;
  }

  return {
    name: node.name,
    path: node.path,
    type: node.type,
    children: node.children?.map(compactTree)
  };
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

function normalizePlan(plan) {
  const toolCalls = Array.isArray(plan.toolCalls)
    ? plan.toolCalls.filter(
        (call) =>
          call &&
          supportedTools.includes(call.tool) &&
          call.input &&
          typeof call.input === "object"
      )
    : [];

  return {
    summary: typeof plan.summary === "string" ? plan.summary : "Workspace plan generated.",
    toolCalls
  };
}

function createDeterministicPlan(prompt) {
  const normalized = prompt.toLowerCase();

  if (normalized.includes("employee")) {
    return {
      summary: "Add employee management with page, data model, API, permission, workflow, and route.",
      toolCalls: [
        {
          tool: "createDataModel",
          input: {
            name: "Employee",
            fields: [
              { name: "id", type: "uuid" },
              { name: "name", type: "string" },
              { name: "department", type: "string" },
              { name: "role", type: "string" },
              { name: "status", type: "string" }
            ]
          }
        },
        {
          tool: "createApi",
          input: {
            name: "EmployeeApi",
            baseUrl: "/api/employees",
            methods: ["GET", "POST", "PUT", "DELETE"]
          }
        },
        {
          tool: "createPermission",
          input: {
            name: "Employee.Read",
            description: "View employee records."
          }
        },
        {
          tool: "createWorkflow",
          input: {
            name: "EmployeeApproval",
            steps: ["Draft", "Review", "Approve", "Notify"]
          }
        },
        {
          tool: "createPage",
          input: {
            name: "Employees Page",
            route: "/employees",
            title: "Employees",
            layout: "MainLayout",
            template: null,
            permissions: ["Employee.Read"]
          }
        },
        {
          tool: "createRoute",
          input: {
            path: "/employees",
            page: "pages/employees-page.txl"
          }
        }
      ]
    };
  }

  return {
    summary: "Create a new dashboard page for the requested capability.",
    toolCalls: [
      {
        tool: "createPage",
        input: {
          name: "Generated Page",
          route: "/generated",
          title: "Generated",
          layout: "MainLayout",
          template: null,
          permissions: []
        }
      },
      {
        tool: "createRoute",
        input: {
          path: "/generated",
          page: "pages/generated-page.txl"
        }
      }
    ]
  };
}

export const aiWorkspaceAgentPlannerService = new AIWorkspaceAgentPlannerService();
