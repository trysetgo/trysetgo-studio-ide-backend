export class TXLFileGenerator {
  generateFiles(graph) {
    const rootName = normalizeProjectRootName(graph.appName);
    const pagePaths = graph.modules.map((module) => `pages/${toFileName(module.name)}.txl`);

    return [
      txlFile(rootName, "project.txl", {
        name: rootName,
        version: "1.0.0",
        type: graph.kind,
        entry: "/app.txl",
        theme: "Modern",
        generatedBy: "AIArchitectService"
      }),
      txlFile(rootName, "app.txl", {
        type: "Application",
        metadata: {
          name: rootName,
          version: "1.0.0",
          description: graph.description
        },
        router: "router/routes.txl",
        layouts: ["layouts/main-layout.txl"],
        templates: ["templates/application-shell.txl"],
        pages: pagePaths,
        workflows: graph.workflows.map((workflow) => `workflows/${toFileName(workflow.name)}.txl`),
        dataModels: graph.dataModels.map((model) => `datamodels/${toFileName(model.name)}.txl`),
        apis: graph.apis.map((api) => `apis/${toFileName(api.name)}.txl`),
        validations: [],
        migrations: [],
        permissions: graph.permissions.map((permission) => `permissions/${toFileName(permission.name)}.txl`),
        themes: ["themes/default.txl"]
      }),
      txlFile(rootName, "router/routes.txl", {
        type: "Router",
        defaultRoute: "/",
        routes: graph.modules.map((module) => ({
          path: module.route,
          page: `pages/${toFileName(module.name)}.txl`
        }))
      }),
      txlFile(rootName, "layouts/main-layout.txl", {
        type: "Layout",
        name: "MainLayout",
        regions: ["header", "sidebar", "content", "footer"],
        slots: {
          header: "components/navbar.txl",
          sidebar: "components/sidebar.txl",
          content: "Page",
          footer: "components/footer.txl"
        }
      }),
      txlFile(rootName, "templates/application-shell.txl", {
        type: "Template",
        name: "ApplicationShell",
        sections: ["Navbar", "Sidebar", "Content", "Footer"]
      }),
      txlFile(rootName, "components/navbar.txl", {
        type: "Component",
        name: "Navbar",
        props: { brand: rootName },
        children: []
      }),
      txlFile(rootName, "components/sidebar.txl", {
        type: "Component",
        name: "Sidebar",
        props: {
          items: graph.modules.map((module) => ({
            label: module.title,
            route: module.route
          }))
        },
        children: []
      }),
      txlFile(rootName, "components/footer.txl", {
        type: "Component",
        name: "Footer",
        props: { text: `${rootName} generated with TXL` },
        children: []
      }),
      ...graph.modules.map((module) =>
        txlFile(rootName, `pages/${toFileName(module.name)}.txl`, {
          type: "Page",
          route: module.route,
          layout: "MainLayout",
          template: "ApplicationShell",
          title: module.title,
          permissions: module.permissions,
          dataModel: module.dataModel ?? null,
          api: module.api ?? null,
          workflow: module.workflow ?? null,
          children: [
            {
              type: "Hero",
              name: `${module.name.replace(/\s/g, "")}Hero`,
              props: {
                eyebrow: graph.kind,
                title: module.title,
                subtitle: `AI-generated TXL module for ${module.title.toLowerCase()}.`
              },
              children: []
            },
            {
              type: "Grid",
              name: `${module.name.replace(/\s/g, "")}Grid`,
              children: [
                {
                  type: "Card",
                  name: "PrimaryCard",
                  props: {
                    title: module.dataModel ?? module.workflow ?? "Workspace",
                    body: "Schema-driven TXL surface ready for AI expansion."
                  },
                  children: []
                }
              ]
            }
          ]
        })
      ),
      ...graph.dataModels.map((model) =>
        txlFile(rootName, `datamodels/${toFileName(model.name)}.txl`, {
          type: "DataModel",
          name: model.name,
          fields: model.fields
        })
      ),
      ...graph.apis.map((api) =>
        txlFile(rootName, `apis/${toFileName(api.name)}.txl`, {
          type: "ApiDefinition",
          name: api.name,
          baseUrl: api.baseUrl,
          methods: api.methods
        })
      ),
      ...graph.workflows.map((workflow) =>
        txlFile(rootName, `workflows/${toFileName(workflow.name)}.txl`, {
          type: "Workflow",
          name: workflow.name,
          steps: workflow.steps
        })
      ),
      ...graph.permissions.map((permission) =>
        txlFile(rootName, `permissions/${toFileName(permission.name)}.txl`, {
          type: "Permission",
          name: permission.name,
          description: permission.description
        })
      ),
      txlFile(rootName, "themes/default.txl", {
        type: "Theme",
        name: "DefaultTheme",
        tokens: {
          color: {
            background: "#0d0f12",
            foreground: "#f5f7fb",
            accent: "#22d3ee"
          },
          typography: {},
          spacing: {}
        }
      }),
      {
        path: `${rootName}/.txlrules`,
        language: "text",
        content: `TXL RULES

1. TXL is AI-first.
2. Only create .txl files.
3. Follow TXL schema.
4. Validate before save.
5. Use registered components.
6. Optimize for AI generation.
`
      }
    ];
  }
}

function txlFile(rootName, relativePath, content) {
  return {
    path: `${rootName}/${relativePath}`,
    language: "json",
    content: JSON.stringify(content, null, 2)
  };
}

function normalizeProjectRootName(value) {
  const normalized = value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 50);
  return normalized || "AIApplication";
}

function toFileName(value) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}
