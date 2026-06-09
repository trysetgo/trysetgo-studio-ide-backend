const KIND_KEYWORDS = [
  { kind: "CRM", keywords: ["crm", "customer", "employee", "approval", "sales"] },
  { kind: "CMS", keywords: ["cms", "content", "article", "publishing"] },
  { kind: "E-Commerce", keywords: ["commerce", "store", "product", "order", "cart"] },
  { kind: "Admin Dashboard", keywords: ["admin", "dashboard", "analytics"] },
  { kind: "Knowledge Portal", keywords: ["knowledge", "wiki", "documentation", "portal"] },
  { kind: "Healthcare Portal", keywords: ["health", "patient", "doctor", "clinic"] }
];

export class ApplicationGraphGenerator {
  generate(prompt) {
    const kind = detectKind(prompt);
    const appName = inferAppName(kind, prompt);
    const modules = createModules(kind);

    return {
      appName,
      kind,
      description: prompt.trim(),
      modules,
      dataModels: createDataModels(modules),
      apis: createApis(modules),
      workflows: createWorkflows(modules),
      permissions: createPermissions(modules)
    };
  }
}

function detectKind(prompt) {
  const normalized = prompt.toLowerCase();
  return (
    KIND_KEYWORDS.find((entry) =>
      entry.keywords.some((keyword) => normalized.includes(keyword))
    )?.kind ?? "Admin Dashboard"
  );
}

function inferAppName(kind, prompt) {
  if (kind === "CRM") return "CRM Platform";
  if (kind === "CMS") return "Content Studio";
  if (kind === "E-Commerce") return "Commerce Platform";
  if (kind === "Knowledge Portal") return "Knowledge Portal";
  if (kind === "Healthcare Portal") return "Healthcare Portal";
  return prompt.toLowerCase().includes("analytics")
    ? "Analytics Dashboard"
    : "Admin Dashboard";
}

function createModules(kind) {
  const common = [
    {
      name: "Home",
      route: "/",
      title: "Overview",
      permissions: ["Application.Access"]
    }
  ];

  const byKind = {
    CRM: [
      module("Customers", "/customers", ["Customer.Read", "Customer.Manage"], "Customer", "CustomersApi"),
      module("Employees", "/employees", ["Employee.Read", "Employee.Manage"], "Employee", "EmployeesApi"),
      module("Approvals", "/approvals", ["Approval.Review"], undefined, undefined, "ApprovalWorkflow"),
      module("Roles", "/roles", ["RBAC.Manage"])
    ],
    CMS: [
      module("Content", "/content", ["Content.Read", "Content.Manage"], "Article", "ContentApi", "PublishingWorkflow")
    ],
    "E-Commerce": [
      module("Products", "/products", ["Product.Manage"], "Product", "ProductsApi"),
      module("Orders", "/orders", ["Order.Read"], "Order", "OrdersApi", "OrderFulfillment")
    ],
    "Admin Dashboard": [
      module("Analytics", "/analytics", ["Analytics.Read"], undefined, "AnalyticsApi")
    ],
    "Knowledge Portal": [
      module("Knowledge Base", "/knowledge", ["Knowledge.Read", "Knowledge.Manage"], "KnowledgeArticle", "KnowledgeApi", "ReviewWorkflow")
    ],
    "Healthcare Portal": [
      module("Patients", "/patients", ["Patient.Read", "Patient.Manage"], "Patient", "PatientsApi"),
      module("Appointments", "/appointments", ["Appointment.Manage"], "Appointment", "AppointmentsApi", "CareApproval")
    ]
  };

  return [...common, ...byKind[kind]];
}

function module(name, route, permissions, dataModel, api, workflow) {
  return {
    name,
    route,
    title: name,
    permissions,
    dataModel,
    api,
    workflow
  };
}

function createDataModels(modules) {
  const fields = {
    Customer: ["id:uuid", "name:string", "email:string", "status:string"],
    Employee: ["id:uuid", "name:string", "department:string", "role:string"],
    Article: ["id:uuid", "title:string", "status:string"],
    Product: ["id:uuid", "name:string", "price:number"],
    Order: ["id:uuid", "total:number", "status:string"],
    KnowledgeArticle: ["id:uuid", "title:string", "category:string"],
    Patient: ["id:uuid", "name:string", "careStatus:string"],
    Appointment: ["id:uuid", "patientId:uuid", "scheduledAt:datetime"]
  };

  return unique(modules.map((item) => item.dataModel).filter(Boolean)).map((name) => ({
    name,
    fields: (fields[name] ?? ["id:uuid", "name:string"]).map((field) => {
      const [fieldName, type] = field.split(":");
      return { name: fieldName, type };
    })
  }));
}

function createApis(modules) {
  return unique(modules.map((item) => item.api).filter(Boolean)).map((name) => ({
    name,
    baseUrl: `/api/${name.replace(/Api$/, "").toLowerCase()}`,
    methods: ["GET", "POST", "PUT", "DELETE"]
  }));
}

function createWorkflows(modules) {
  return unique(modules.map((item) => item.workflow).filter(Boolean)).map((name) => ({
    name,
    steps: ["Draft", "Review", "Approve", "Notify"]
  }));
}

function createPermissions(modules) {
  return unique(modules.flatMap((item) => item.permissions)).map((name) => ({
    name,
    description: `Allows ${name.toLowerCase().replace(".", " ")} operations.`
  }));
}

function unique(values) {
  return Array.from(new Set(values));
}
