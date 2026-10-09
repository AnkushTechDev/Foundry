export const FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "object",
  "array",
  "reference",
  "enum",
] as const;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const API_AUTH_MODES = ["public", "authenticated", "role", "apiKey"] as const;

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;

export const APP_ROLES = ["admin", "member"] as const;

export const NODE_TYPES = [
  "httpTrigger",
  "webhookTrigger",
  "scheduleTrigger",
  "manualTrigger",
  "findOne",
  "findMany",
  "createRecord",
  "updateRecord",
  "deleteRecord",
  "countRecords",
  "aggregate",
  "condition",
  "switch",
  "loop",
  "delay",
  "merge",
  "setVariable",
  "transform",
  "validate",
  "httpRequest",
  "jsonParse",
  "jsonTransform",
  "stringTransform",
  "dateTransform",
  "math",
  "generateUuid",
  "llmPrompt",
  "returnResponse",
  "throwError",
] as const;

export const COMPONENT_TYPES = [
  "Container",
  "Row",
  "Column",
  "Grid",
  "Card",
  "Tabs",
  "Divider",
  "Heading",
  "Text",
  "Label",
  "Input",
  "Textarea",
  "Select",
  "Checkbox",
  "Radio",
  "Switch",
  "DatePicker",
  "Button",
  "Form",
  "Table",
  "List",
  "Badge",
  "Avatar",
  "Pagination",
  "Image",
  "Icon",
  "Navbar",
  "Sidebar",
  "Link",
  "Modal",
  "Drawer",
  "Alert",
  "Loader",
] as const;

export const TRIGGER_TYPES = [
  "httpTrigger",
  "webhookTrigger",
  "scheduleTrigger",
  "manualTrigger",
] as const;

export const LAYOUT_COMPONENTS = new Set<ComponentType>([
  "Container",
  "Row",
  "Column",
  "Grid",
  "Card",
  "Tabs",
  "Form",
  "Modal",
  "Drawer",
  "Navbar",
  "Sidebar",
]);

export const PLANS = {
  free: { projects: 2, publishedApps: 1, apiCalls: 10_000 },
  pro: { projects: 100, publishedApps: 10, apiCalls: 1_000_000 },
  business: { projects: 1_000, publishedApps: 100, apiCalls: 10_000_000 },
} as const;

export const LIMITS = {
  maxWorkflowNodes: 80,
  maxWorkflowSteps: 200,
  maxVisitsPerNode: 8,
  maxLoopIterations: 100,
  workflowTimeoutMs: 15_000,
  httpTimeoutMs: 10_000,
  maxHttpResponseBytes: 1_000_000,
  maxPayloadBytes: 1_000_000,
  maxRecordsPerQuery: 100,
  maxExpressionCache: 500,
  maxHistory: 50,
  maxFields: 60,
  maxComponents: 400,
} as const;

export type FieldType = (typeof FIELD_TYPES)[number];
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type ApiAuthMode = (typeof API_AUTH_MODES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type AppRole = (typeof APP_ROLES)[number];
export type NodeType = (typeof NODE_TYPES)[number];
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const ROLE_RANK: Record<MemberRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function hasRole(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
