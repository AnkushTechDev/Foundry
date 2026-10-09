import type { FilterClause, WorkflowDef } from "@foundry/shared";

export interface QueryInput {
  projectId: string;
  modelId: string;
  filters: FilterClause[];
  sort?: { field: string; direction: "asc" | "desc" };
  limit: number;
  projection?: string[];
}

export interface DataPort {
  findMany(input: QueryInput): Promise<Record<string, unknown>[]>;
  findOne(input: QueryInput & { id?: string }): Promise<Record<string, unknown> | null>;
  create(input: { projectId: string; modelId: string; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  update(input: { projectId: string; modelId: string; id: string; data: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  delete(input: { projectId: string; modelId: string; id: string }): Promise<boolean>;
  count(input: QueryInput): Promise<number>;
  countBy(input: { projectId: string; modelId: string; field: string }): Promise<Array<{ key: string; count: number }>>;
}

export interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HttpPort {
  request(input: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    timeoutMs: number;
  }): Promise<HttpResult>;
  resolveConnection?(id: string): Promise<{ baseUrl: string; headers: Record<string, string> } | null>;
}

export interface AiPort {
  complete(prompt: string): Promise<{ text: string; tokens: number }>;
}

export interface TriggerInput {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  method?: string;
  path?: string;
}

export interface NodeLog {
  nodeId: string;
  nodeType: string;
  label: string;
  status: "success" | "error";
  input: unknown;
  output: unknown;
  error?: string;
  durationMs: number;
  branch?: string;
}

export interface WorkflowResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface WorkflowResult {
  status: "success" | "error";
  response: WorkflowResponse;
  logs: NodeLog[];
  durationMs: number;
  error?: { code: string; message: string; nodeId?: string };
}

export interface ExecuteInput {
  workflow: WorkflowDef;
  projectId: string;
  trigger?: TriggerInput;
  data: DataPort;
  http?: HttpPort;
  ai?: AiPort;
  variables?: Record<string, unknown>;
  env?: Record<string, string>;
  secrets?: Record<string, string>;
  timeoutMs?: number;
}

export interface NodeExecResult {
  output: unknown;
  branch?: string;
  halt?: boolean;
  response?: WorkflowResponse;
  failIfUnrouted?: boolean;
  failMessage?: string;
}

export interface ExecContext {
  node: WorkflowDef["nodes"][number];
  scope: Record<string, unknown>;
  data: DataPort;
  http?: HttpPort;
  ai?: AiPort;
  projectId: string;
  resolve: (value: unknown) => unknown;
}

export type NodeExecutor = (ctx: ExecContext) => Promise<NodeExecResult>;
