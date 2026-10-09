import { randomUUID } from "node:crypto";
import { AppError, LIMITS, isSafeKey, resolveTemplate, type FilterClause } from "@foundry/shared";
import type { ExecContext, NodeExecutor, NodeExecResult } from "./types";

function config(ctx: ExecContext): Record<string, unknown> {
  return ctx.node.data.config ?? {};
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function filters(value: unknown): FilterClause[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]);
  const output: FilterClause[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as FilterClause;
    if (!isSafeKey(row.field) && row.field !== "id") continue;
    if (!allowed.has(row.op)) continue;
    output.push({ field: row.field, op: row.op, value: row.value });
  }
  return output;
}

function queryFilters(scope: Record<string, unknown>): FilterClause[] {
  const query = record(record(scope.trigger).query);
  const output: FilterClause[] = [];
  for (const [field, value] of Object.entries(query)) {
    if (!isSafeKey(field) || value == null || value === "") continue;
    output.push({ field, op: "eq", value });
  }
  return output;
}

function modelId(ctx: ExecContext): string {
  const id = text(ctx.resolve(config(ctx).modelId)).trim();
  if (!id) throw new AppError("WORKFLOW_NODE_FAILED", "A collection is required");
  return id;
}

function limitOf(value: unknown): number {
  const limit = Number(value ?? 50);
  if (!Number.isFinite(limit)) return 50;
  return Math.min(LIMITS.maxRecordsPerQuery, Math.max(1, Math.floor(limit)));
}

async function trigger(ctx: ExecContext): Promise<NodeExecResult> {
  return { output: ctx.scope.trigger ?? {} };
}

async function findMany(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const combined = [
    ...filters(ctx.resolve(current.filters)),
    ...(current.filterFromQuery === true ? queryFilters(ctx.scope) : []),
  ];
  const sortField = text(current.sortField || "");
  const output = await ctx.data.findMany({
    projectId: ctx.projectId,
    modelId: modelId(ctx),
    filters: combined,
    limit: limitOf(ctx.resolve(current.limit)),
    sort: sortField
      ? { field: sortField, direction: current.sortDirection === "asc" ? "asc" : "desc" }
      : { field: "createdAt", direction: "desc" },
    projection: Array.isArray(current.projection) ? current.projection.map(String).filter(isSafeKey) : undefined,
  });
  return { output };
}

async function findOne(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const id = text(ctx.resolve(current.id) ?? "").trim();
  const output = await ctx.data.findOne({
    projectId: ctx.projectId,
    modelId: modelId(ctx),
    id: id || undefined,
    filters: filters(ctx.resolve(current.filters)),
    limit: 1,
  });
  return { output };
}

async function createRecord(ctx: ExecContext): Promise<NodeExecResult> {
  const data = record(ctx.resolve(config(ctx).data));
  const output = await ctx.data.create({ projectId: ctx.projectId, modelId: modelId(ctx), data });
  return { output };
}

async function updateRecord(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const id = text(ctx.resolve(current.id)).trim();
  if (!id) throw new AppError("WORKFLOW_NODE_FAILED", "Update requires an id");
  const output = await ctx.data.update({
    projectId: ctx.projectId,
    modelId: modelId(ctx),
    id,
    data: record(ctx.resolve(current.data)),
  });
  if (!output) throw new AppError("NOT_FOUND", "Record not found", 404);
  return { output };
}

async function deleteRecord(ctx: ExecContext): Promise<NodeExecResult> {
  const id = text(ctx.resolve(config(ctx).id)).trim();
  if (!id) throw new AppError("WORKFLOW_NODE_FAILED", "Delete requires an id");
  const deleted = await ctx.data.delete({ projectId: ctx.projectId, modelId: modelId(ctx), id });
  if (!deleted) throw new AppError("NOT_FOUND", "Record not found", 404);
  return { output: { deleted: true, id } };
}

async function countRecords(ctx: ExecContext): Promise<NodeExecResult> {
  const count = await ctx.data.count({
    projectId: ctx.projectId,
    modelId: modelId(ctx),
    filters: filters(ctx.resolve(config(ctx).filters)),
    limit: 1,
  });
  return { output: { count } };
}

async function aggregate(ctx: ExecContext): Promise<NodeExecResult> {
  const field = text(config(ctx).groupBy);
  if (!isSafeKey(field)) throw new AppError("WORKFLOW_NODE_FAILED", "Aggregate needs a field");
  const output = await ctx.data.countBy({ projectId: ctx.projectId, modelId: modelId(ctx), field });
  return { output };
}

function exists(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

async function condition(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const operator = text(current.operator || "expression");
  let ok = false;
  if (operator === "exists") ok = exists(ctx.resolve(current.value));
  else if (operator === "empty") ok = !exists(ctx.resolve(current.value));
  else if (operator === "expression" || operator === "") ok = Boolean(ctx.resolve(current.expression ?? current.value));
  else {
    const left = ctx.resolve(current.left ?? current.value);
    const right = ctx.resolve(current.right);
    if (operator === "eq") ok = Object.is(left, right);
    else if (operator === "neq") ok = !Object.is(left, right);
    else if (operator === "contains") ok = text(left).includes(text(right));
    else if (operator === "gt") ok = Number(left) > Number(right);
    else if (operator === "lt") ok = Number(left) < Number(right);
    else ok = Boolean(left);
  }
  return { output: { result: ok }, branch: ok ? "true" : "false" };
}

async function switchNode(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const value = text(ctx.resolve(current.value));
  const cases = Array.isArray(current.cases) ? current.cases.map(String) : [];
  const branch = cases.includes(value) ? value : "default";
  return { output: { value }, branch };
}

async function loop(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const source = ctx.resolve(current.source);
  const items = Array.isArray(source) ? source.slice(0, LIMITS.maxLoopIterations) : [];
  const mapping = current.mapping ?? { item: "{{item}}" };
  const output = items.map((item) => resolveTemplate(mapping, { ...ctx.scope, item }));
  return { output };
}

async function delay(ctx: ExecContext): Promise<NodeExecResult> {
  const requested = Number(ctx.resolve(config(ctx).ms) ?? 0);
  const ms = Math.min(5_000, Math.max(0, Number.isFinite(requested) ? requested : 0));
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  return { output: { delayedMs: ms } };
}

async function merge(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const sources = Array.isArray(current.sources) ? current.sources.map((item) => ctx.resolve(item)) : [];
  if (current.mode === "concat") {
    return { output: sources.flatMap((item) => (Array.isArray(item) ? item : [item])) };
  }
  return {
    output: Object.assign(
      {},
      ...sources.filter((item) => item && typeof item === "object" && !Array.isArray(item)),
    ),
  };
}

async function setVariable(ctx: ExecContext): Promise<NodeExecResult> {
  const name = text(config(ctx).name);
  if (!isSafeKey(name)) throw new AppError("WORKFLOW_NODE_FAILED", "Variable name is invalid");
  const value = ctx.resolve(config(ctx).value);
  const variables = record(ctx.scope.variables);
  variables[name] = value;
  ctx.scope.variables = variables;
  return { output: { [name]: value } };
}

async function transform(ctx: ExecContext): Promise<NodeExecResult> {
  return { output: ctx.resolve(config(ctx).mapping ?? {}) };
}

async function validate(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const source = record(ctx.resolve(current.source ?? "{{trigger.body}}"));
  const rules = Array.isArray(current.rules) ? current.rules : [];
  const errors: Array<{ field: string; message: string }> = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const row = rule as { field?: string; required?: boolean; type?: string };
    if (!row.field || !isSafeKey(row.field)) continue;
    const value = source[row.field];
    if (row.required && (value == null || value === "")) {
      errors.push({ field: row.field, message: "Required" });
      continue;
    }
    if (value == null || value === "") continue;
    if (row.type === "string" && typeof value !== "string") errors.push({ field: row.field, message: "Must be text" });
    if (row.type === "number" && !Number.isFinite(Number(value))) errors.push({ field: row.field, message: "Must be a number" });
    if (row.type === "boolean" && typeof value !== "boolean") errors.push({ field: row.field, message: "Must be true or false" });
  }
  const valid = errors.length === 0;
  return {
    output: { valid, errors, value: source },
    branch: valid ? "valid" : "invalid",
    failIfUnrouted: !valid,
    failMessage: errors.map((error) => `${error.field}: ${error.message}`).join(", ") || "Validation failed",
  };
}

async function httpRequest(ctx: ExecContext): Promise<NodeExecResult> {
  if (!ctx.http) throw new AppError("WORKFLOW_NODE_FAILED", "HTTP requests are unavailable");
  const current = config(ctx);
  let url = text(ctx.resolve(current.url)).trim();
  const headers: Record<string, string> = {};
  const connectionId = text(current.connectionId);
  if (connectionId && ctx.http.resolveConnection) {
    const connection = await ctx.http.resolveConnection(connectionId);
    if (!connection) throw new AppError("WORKFLOW_NODE_FAILED", "Connection not found");
    Object.assign(headers, connection.headers);
    if (url.startsWith("/")) url = `${connection.baseUrl.replace(/\/$/, "")}${url}`;
  }
  const extra = record(ctx.resolve(current.headers ?? {}));
  for (const [key, value] of Object.entries(extra)) headers[key] = text(value);
  const output = await ctx.http.request({
    url,
    method: text(current.method || "GET").toUpperCase(),
    headers,
    body: ctx.resolve(current.body),
    timeoutMs: LIMITS.httpTimeoutMs,
  });
  return { output };
}

async function jsonParse(ctx: ExecContext): Promise<NodeExecResult> {
  const value = ctx.resolve(config(ctx).value);
  if (typeof value !== "string") return { output: value };
  try {
    return { output: JSON.parse(value) };
  } catch {
    throw new AppError("WORKFLOW_NODE_FAILED", "JSON parse failed");
  }
}

async function stringTransform(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  let value = text(ctx.resolve(current.value));
  const op = text(current.op || "trim");
  if (op === "upper") value = value.toUpperCase();
  else if (op === "lower") value = value.toLowerCase();
  else if (op === "trim") value = value.trim();
  else if (op === "template") value = text(ctx.resolve(current.template));
  return { output: value };
}

async function dateTransform(ctx: ExecContext): Promise<NodeExecResult> {
  const value = ctx.resolve(config(ctx).value);
  const date = value ? new Date(text(value)) : new Date();
  if (Number.isNaN(date.getTime())) throw new AppError("WORKFLOW_NODE_FAILED", "Invalid date");
  return { output: date.toISOString() };
}

async function math(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const values = (Array.isArray(current.values) ? current.values : []).map((value) => Number(ctx.resolve(value)));
  if (values.some((value) => !Number.isFinite(value))) throw new AppError("WORKFLOW_NODE_FAILED", "Math inputs must be numbers");
  const op = text(current.op || "add");
  let output = 0;
  if (op === "add") output = values.reduce((sum, value) => sum + value, 0);
  else if (op === "sub") output = values.slice(1).reduce((sum, value) => sum - value, values[0] ?? 0);
  else if (op === "mul") output = values.reduce((sum, value) => sum * value, 1);
  else if (op === "div") output = values.slice(1).reduce((sum, value) => (value === 0 ? sum : sum / value), values[0] ?? 0);
  else if (op === "min") output = Math.min(...values);
  else if (op === "max") output = Math.max(...values);
  else throw new AppError("WORKFLOW_NODE_FAILED", "Unknown math operation");
  return { output };
}

async function generateUuid(): Promise<NodeExecResult> {
  return { output: randomUUID() };
}

async function llmPrompt(ctx: ExecContext): Promise<NodeExecResult> {
  if (!ctx.ai) throw new AppError("AI_NOT_CONFIGURED", "Add an API key to run AI nodes", 400);
  const prompt = text(ctx.resolve(config(ctx).prompt));
  if (!prompt.trim()) throw new AppError("WORKFLOW_NODE_FAILED", "Prompt is empty");
  const result = await ctx.ai.complete(prompt.slice(0, 8_000));
  return { output: { text: result.text, tokens: result.tokens } };
}

async function returnResponse(ctx: ExecContext): Promise<NodeExecResult> {
  const current = config(ctx);
  const statusCode = Number(ctx.resolve(current.statusCode) ?? 200);
  const body = ctx.resolve(current.body ?? {});
  const headerRecord = record(ctx.resolve(current.headers ?? {}));
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(headerRecord)) headers[key] = text(value);
  const response = {
    statusCode: Number.isFinite(statusCode) ? Math.min(599, Math.max(100, Math.floor(statusCode))) : 200,
    body,
    headers,
  };
  return { output: body, halt: true, response };
}

async function throwError(ctx: ExecContext): Promise<NodeExecResult> {
  const message = text(ctx.resolve(config(ctx).message) || "Workflow error");
  const status = Number(config(ctx).statusCode ?? 400);
  throw new AppError("WORKFLOW_NODE_FAILED", message, Number.isFinite(status) ? status : 400);
}

export const executors: Record<string, NodeExecutor> = {
  httpTrigger: trigger,
  webhookTrigger: trigger,
  scheduleTrigger: trigger,
  manualTrigger: trigger,
  findOne,
  findMany,
  createRecord,
  updateRecord,
  deleteRecord,
  countRecords,
  aggregate,
  condition,
  switch: switchNode,
  loop,
  delay,
  merge,
  setVariable,
  transform,
  jsonTransform: transform,
  validate,
  httpRequest,
  jsonParse,
  stringTransform,
  dateTransform,
  math,
  generateUuid,
  llmPrompt,
  returnResponse,
  throwError,
};
