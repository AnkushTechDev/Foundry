import type { HttpMethod } from "./constants";
import { createId, fieldKey, pluralize, slugify } from "./ids";
import type { ComponentNode, FieldDef, PageDef, QueryDef, WorkflowDef } from "./schemas";

export interface ModelDraft {
  name: string;
  fields: FieldDef[];
}

export interface ApiDraft {
  name: string;
  method: HttpMethod;
  path: string;
  auth: "public" | "authenticated" | "role" | "apiKey";
  workflow: WorkflowDef;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  models: ModelDraft[];
  upsertOnEmail?: boolean;
}

function field(
  name: string,
  type: FieldDef["type"],
  extra: Partial<FieldDef> = {},
): FieldDef {
  return {
    id: extra.id ?? createId(),
    name,
    key: extra.key ?? fieldKey(name),
    type,
    required: extra.required ?? false,
    unique: extra.unique ?? false,
    index: extra.index ?? extra.unique ?? false,
    defaultValue: extra.defaultValue,
    min: extra.min,
    max: extra.max,
    pattern: extra.pattern,
    enumValues: extra.enumValues,
    refModelId: extra.refModelId,
    itemType: extra.itemType,
  };
}

function node(
  id: string,
  type: WorkflowDef["nodes"][number]["type"],
  label: string,
  config: Record<string, unknown>,
  x: number,
  y = 80,
): WorkflowDef["nodes"][number] {
  return { id, type, position: { x, y }, data: { label, config } };
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string,
): WorkflowDef["edges"][number] {
  return { id: createId(), source, target, sourceHandle };
}

function ref(id: string, suffix = "output"): string {
  return `{{nodes["${id}"].${suffix}}}`;
}

export function buildCrudApis(modelName: string, modelId: string): ApiDraft[] {
  const plural = pluralize(modelName);
  const base = `/${plural}`;

  const listFind = createId();
  const listReturn = createId();
  const listTrigger = createId();

  const getTrigger = createId();
  const getFind = createId();
  const getCheck = createId();
  const getOk = createId();
  const getMissing = createId();

  const createTrigger = createId();
  const createNode = createId();
  const createReturn = createId();

  const patchTrigger = createId();
  const patchNode = createId();
  const patchReturn = createId();

  const deleteTrigger = createId();
  const deleteNode = createId();
  const deleteReturn = createId();

  return [
    {
      name: `List ${plural}`,
      method: "GET",
      path: base,
      auth: "public",
      workflow: {
        name: `List ${plural}`,
        nodes: [
          node(listTrigger, "httpTrigger", "HTTP Trigger", {}, 40),
          node(listFind, "findMany", "Find Many", { modelId, limit: 50, filterFromQuery: true }, 280),
          node(listReturn, "returnResponse", "Return", { statusCode: 200, body: { items: ref(listFind) } }, 520),
        ],
        edges: [edge(listTrigger, listFind, "out"), edge(listFind, listReturn, "out")],
      },
    },
    {
      name: `Get ${modelName}`,
      method: "GET",
      path: `${base}/:id`,
      auth: "public",
      workflow: {
        name: `Get ${modelName}`,
        nodes: [
          node(getTrigger, "httpTrigger", "HTTP Trigger", {}, 40),
          node(getFind, "findOne", "Find One", { modelId, id: "{{trigger.params.id}}" }, 280),
          node(getCheck, "condition", "Exists", { operator: "exists", value: ref(getFind) }, 520),
          node(getOk, "returnResponse", "Return 200", { statusCode: 200, body: ref(getFind) }, 760, 0),
          node(getMissing, "returnResponse", "Return 404", { statusCode: 404, body: { message: `${modelName} not found` } }, 760, 180),
        ],
        edges: [
          edge(getTrigger, getFind, "out"),
          edge(getFind, getCheck, "out"),
          edge(getCheck, getOk, "true"),
          edge(getCheck, getMissing, "false"),
        ],
      },
    },
    {
      name: `Create ${modelName}`,
      method: "POST",
      path: base,
      auth: "public",
      workflow: {
        name: `Create ${modelName}`,
        nodes: [
          node(createTrigger, "httpTrigger", "HTTP Trigger", {}, 40),
          node(createNode, "createRecord", "Create", { modelId, data: "{{trigger.body}}" }, 280),
          node(createReturn, "returnResponse", "Return 201", { statusCode: 201, body: ref(createNode) }, 520),
        ],
        edges: [edge(createTrigger, createNode, "out"), edge(createNode, createReturn, "out")],
      },
    },
    {
      name: `Update ${modelName}`,
      method: "PATCH",
      path: `${base}/:id`,
      auth: "public",
      workflow: {
        name: `Update ${modelName}`,
        nodes: [
          node(patchTrigger, "httpTrigger", "HTTP Trigger", {}, 40),
          node(patchNode, "updateRecord", "Update", { modelId, id: "{{trigger.params.id}}", data: "{{trigger.body}}" }, 280),
          node(patchReturn, "returnResponse", "Return 200", { statusCode: 200, body: ref(patchNode) }, 520),
        ],
        edges: [edge(patchTrigger, patchNode, "out"), edge(patchNode, patchReturn, "out")],
      },
    },
    {
      name: `Delete ${modelName}`,
      method: "DELETE",
      path: `${base}/:id`,
      auth: "public",
      workflow: {
        name: `Delete ${modelName}`,
        nodes: [
          node(deleteTrigger, "httpTrigger", "HTTP Trigger", {}, 40),
          node(deleteNode, "deleteRecord", "Delete", { modelId, id: "{{trigger.params.id}}" }, 280),
          node(deleteReturn, "returnResponse", "Return 200", { statusCode: 200, body: { deleted: true } }, 520),
        ],
        edges: [edge(deleteTrigger, deleteNode, "out"), edge(deleteNode, deleteReturn, "out")],
      },
    },
  ];
}

export function buildUpsertByEmailApi(modelName: string, modelId: string): ApiDraft {
  const plural = pluralize(modelName);
  const trigger = createId();
  const validate = createId();
  const find = createId();
  const check = createId();
  const conflict = createId();
  const create = createId();
  const created = createId();
  return {
    name: `Create ${modelName}`,
    method: "POST",
    path: `/${plural}`,
    auth: "public",
    workflow: {
      name: `Create ${modelName} if email is new`,
      nodes: [
        node(trigger, "httpTrigger", "HTTP Trigger", {}, 40),
        node(validate, "validate", "Validate Input", {
          source: "{{trigger.body}}",
          rules: [
            { field: "email", required: true, type: "string" },
            { field: "name", required: true, type: "string" },
          ],
        }, 280),
        node(find, "findOne", "Find By Email", {
          modelId,
          filters: [{ field: "email", op: "eq", value: "{{trigger.body.email}}" }],
        }, 520),
        node(check, "condition", "Already Exists", { operator: "exists", value: ref(find) }, 760),
        node(conflict, "returnResponse", "Return 409", { statusCode: 409, body: { message: "A record with this email already exists" } }, 1000, 0),
        node(create, "createRecord", "Create", { modelId, data: "{{trigger.body}}" }, 1000, 180),
        node(created, "returnResponse", "Return 201", { statusCode: 201, body: ref(create) }, 1240, 180),
      ],
      edges: [
        edge(trigger, validate, "out"),
        edge(validate, find, "valid"),
        edge(find, check, "out"),
        edge(check, conflict, "true"),
        edge(check, create, "false"),
        edge(create, created, "out"),
      ],
    },
  };
}

function inputFor(fieldDef: FieldDef, formName: string): ComponentNode {
  const binding = `{{form.${formName}.${fieldDef.key}}}`;
  const common = { name: fieldDef.key, label: fieldDef.name, placeholder: fieldDef.name };
  if (fieldDef.type === "boolean") {
    return { id: createId(), type: "Checkbox", props: { ...common, checked: binding }, children: [] };
  }
  if (fieldDef.type === "enum") {
    return {
      id: createId(),
      type: "Select",
      props: { ...common, value: binding, options: fieldDef.enumValues ?? [] },
      children: [],
    };
  }
  if (fieldDef.type === "date") {
    return { id: createId(), type: "DatePicker", props: { ...common, value: binding }, children: [] };
  }
  return {
    id: createId(),
    type: fieldDef.type === "object" || (fieldDef.max ?? 0) > 120 ? "Textarea" : "Input",
    props: {
      ...common,
      value: binding,
      inputType: fieldDef.type === "number" ? "number" : "text",
    },
    children: [],
  };
}

export function buildCrudPage(modelName: string, fields: FieldDef[]): PageDef {
  const plural = pluralize(modelName);
  const path = `/${plural}`;
  const queryName = plural.replace(/-/g, "_");
  const formName = "create";
  const query: QueryDef = {
    id: createId(),
    name: queryName,
    source: "internal",
    method: "GET",
    path,
    runOnLoad: true,
  };
  const body = Object.fromEntries(fields.map((item) => [item.key, `{{form.${formName}.${item.key}}}`]));
  const root: ComponentNode = {
    id: createId(),
    type: "Container",
    props: {},
    style: { padding: 28, gap: 20 },
    children: [
      {
        id: createId(),
        type: "Heading",
        props: { text: modelName, level: 1 },
        children: [],
      },
      {
        id: createId(),
        type: "Text",
        props: { text: `Create and review ${plural}.` },
        children: [],
      },
      {
        id: createId(),
        type: "Card",
        props: { title: `Add ${modelName}` },
        style: { padding: 16, gap: 12 },
        children: [
          {
            id: createId(),
            type: "Form",
            props: { name: formName },
            style: { gap: 12 },
            children: [
              ...fields.filter((item) => item.type !== "object").slice(0, 8).map((item) => inputFor(item, formName)),
              {
                id: createId(),
                type: "Button",
                props: { text: `Add ${modelName}`, variant: "primary", buttonType: "submit" },
                children: [],
              },
            ],
            actions: [
              {
                id: createId(),
                event: "submit",
                type: "api.call",
                config: {
                  method: "POST",
                  path,
                  body,
                  toast: `${modelName} created`,
                  refreshQuery: queryName,
                  resetForm: formName,
                },
              },
            ],
          },
        ],
      },
      {
        id: createId(),
        type: "Table",
        props: {
          query: queryName,
          columns: fields.slice(0, 6).map((item) => ({ key: item.key, header: item.name })),
        },
        children: [],
      },
    ],
  };
  return {
    name: modelName,
    slug: slugify(plural),
    path,
    title: modelName,
    auth: "public",
    queries: [query],
    variables: {},
    root,
  };
}

function model(name: string, fields: FieldDef[]): ModelDraft {
  return { name, fields };
}

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: "crm",
    name: "CRM",
    description: "Companies, contacts, and deals with list pages and CRUD APIs.",
    category: "Sales",
    models: [
      model("Company", [
        field("Name", "string", { required: true }),
        field("Website", "string"),
        field("Industry", "string"),
      ]),
      model("Contact", [
        field("Name", "string", { required: true }),
        field("Email", "string", { required: true, unique: true }),
        field("Company", "string"),
      ]),
      model("Deal", [
        field("Title", "string", { required: true }),
        field("Value", "number", { min: 0 }),
        field("Status", "enum", { enumValues: ["open", "won", "lost"], required: true, defaultValue: "open" }),
        field("Expected Close", "date"),
      ]),
    ],
  },
  {
    id: "employees",
    name: "Employee Management",
    description: "Employee directory with department, salary, and active status.",
    category: "HR",
    models: [
      model("Employee", [
        field("Name", "string", { required: true }),
        field("Email", "string", { required: true, unique: true }),
        field("Department", "string", { required: true }),
        field("Salary", "number", { min: 0 }),
        field("Active", "boolean", { defaultValue: true }),
      ]),
    ],
  },
  {
    id: "inventory",
    name: "Inventory Management",
    description: "Products with SKU, price, supplier, and stock levels.",
    category: "Operations",
    models: [
      model("Product", [
        field("Name", "string", { required: true }),
        field("SKU", "string", { required: true, unique: true }),
        field("Price", "number", { required: true, min: 0 }),
        field("Supplier", "string"),
        field("Stock", "number", { required: true, min: 0, defaultValue: 0 }),
      ]),
    ],
  },
  {
    id: "support",
    name: "Support Ticket System",
    description: "Track customer issues, priority, and status.",
    category: "Support",
    models: [
      model("Ticket", [
        field("Subject", "string", { required: true }),
        field("Requester", "string", { required: true }),
        field("Priority", "enum", { enumValues: ["low", "medium", "high"], defaultValue: "medium" }),
        field("Status", "enum", { enumValues: ["open", "pending", "solved"], defaultValue: "open" }),
        field("Description", "string"),
      ]),
    ],
  },
  {
    id: "projects",
    name: "Project Management",
    description: "Projects and tasks with owners and due dates.",
    category: "Work",
    models: [
      model("Project", [
        field("Name", "string", { required: true }),
        field("Owner", "string", { required: true }),
        field("Status", "enum", { enumValues: ["planned", "active", "done"], defaultValue: "planned" }),
      ]),
      model("Task", [
        field("Title", "string", { required: true }),
        field("Project", "string"),
        field("Due Date", "date"),
        field("Done", "boolean", { defaultValue: false }),
      ]),
    ],
  },
  {
    id: "leads",
    name: "Lead Management",
    description: "Capture leads and reject duplicate emails in the create workflow.",
    category: "Sales",
    upsertOnEmail: true,
    models: [
      model("Lead", [
        field("Name", "string", { required: true }),
        field("Email", "string", { required: true, unique: true }),
        field("Company", "string"),
        field("Status", "enum", { enumValues: ["new", "working", "qualified", "lost"], defaultValue: "new" }),
      ]),
    ],
  },
];

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
