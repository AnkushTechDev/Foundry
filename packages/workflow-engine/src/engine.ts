import { AppError, LIMITS, isAppError, nodeAlias, resolveTemplate } from "@foundry/shared";
import { executors } from "./executors";
import type { ExecuteInput, NodeLog, WorkflowResult } from "./types";

const SECRET = /pass|secret|token|authorization|api[-_]?key|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[max-depth]";
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET.test(key) ? "[redacted]" : redact(entry, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 4_000) return `${value.slice(0, 4_000)}…`;
  return value;
}

function clip(value: unknown): unknown {
  try {
    const safe = redact(value);
    const json = JSON.stringify(safe);
    if (json.length <= 20_000) return safe;
    return { truncated: true, preview: json.slice(0, 2_000) };
  } catch {
    return { unserializable: true };
  }
}

export async function executeWorkflow(input: ExecuteInput): Promise<WorkflowResult> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? LIMITS.workflowTimeoutMs;
  const nodes = input.workflow.nodes ?? [];
  const edges = input.workflow.edges ?? [];
  const logs: NodeLog[] = [];

  const fail = (code: string, message: string, statusCode = 400, nodeId?: string): WorkflowResult => ({
    status: "error",
    response: { statusCode, body: { message } },
    logs,
    durationMs: Date.now() - started,
    error: { code, message, nodeId },
  });

  if (nodes.length === 0) return fail("WORKFLOW_EMPTY", "Workflow has no nodes");
  if (nodes.length > LIMITS.maxWorkflowNodes) return fail("WORKFLOW_TOO_LARGE", "Workflow has too many nodes");

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, typeof edges>();
  const incoming = new Map<string, number>();
  for (const node of nodes) incoming.set(node.id, 0);
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }

  const trigger =
    nodes.find((node) => node.type.endsWith("Trigger")) ??
    nodes.find((node) => (incoming.get(node.id) ?? 0) === 0);
  if (!trigger) return fail("WORKFLOW_NO_TRIGGER", "Workflow has no trigger");

  const scope: Record<string, unknown> = {
    trigger: {
      body: input.trigger?.body ?? {},
      query: input.trigger?.query ?? {},
      params: input.trigger?.params ?? {},
      headers: input.trigger?.headers ?? {},
      method: input.trigger?.method ?? "POST",
      path: input.trigger?.path ?? "",
    },
    nodes: {} as Record<string, { output: unknown }>,
    variables: { ...(input.variables ?? {}) },
    env: input.env ?? {},
    secrets: input.secrets ?? {},
  };

  const queue = [trigger.id];
  const visits = new Map<string, number>();
  let steps = 0;
  let response: WorkflowResult["response"] | null = null;

  while (queue.length) {
    if (Date.now() - started > timeoutMs) return fail("WORKFLOW_TIMEOUT", "Execution timed out", 504);
    const nodeId = queue.shift();
    if (!nodeId) break;
    const node = byId.get(nodeId);
    if (!node) continue;
    const seen = (visits.get(nodeId) ?? 0) + 1;
    visits.set(nodeId, seen);
    if (seen > LIMITS.maxVisitsPerNode) {
      return fail("WORKFLOW_CYCLE", `Node "${node.data.label}" repeated too many times`, 400, nodeId);
    }
    steps += 1;
    if (steps > LIMITS.maxWorkflowSteps) return fail("WORKFLOW_STEP_LIMIT", "Execution exceeded the step limit", 400, nodeId);

    const executor = executors[node.type];
    const nodeStarted = Date.now();
    if (!executor) {
      logs.push({
        nodeId,
        nodeType: node.type,
        label: node.data.label,
        status: "error",
        input: clip(node.data.config),
        output: null,
        error: "Unsupported node",
        durationMs: 0,
      });
      return fail("WORKFLOW_NODE_FAILED", `Unsupported node "${node.type}"`, 400, nodeId);
    }

    try {
      const result = await executor({
        node,
        scope,
        data: input.data,
        http: input.http,
        ai: input.ai,
        projectId: input.projectId,
        resolve: (value) => resolveTemplate(value, scope),
      });
      const outputs = scope.nodes as Record<string, { output: unknown }>;
      outputs[node.id] = { output: result.output };
      const alias = nodeAlias(node.data.label);
      if (alias && !outputs[alias]) outputs[alias] = { output: result.output };

      const branch = result.branch;
      const next = (outgoing.get(nodeId) ?? []).filter((edge) => {
        const handle = edge.sourceHandle || "out";
        if (!branch) return handle === "out" || handle === "default";
        return handle === branch;
      });
      logs.push({
        nodeId,
        nodeType: node.type,
        label: node.data.label,
        status: "success",
        input: clip(resolveTemplate(node.data.config, scope)),
        output: clip(result.output),
        durationMs: Date.now() - nodeStarted,
        branch,
      });
      if (result.response) response = result.response;
      if (result.failIfUnrouted && next.length === 0) {
        return fail("VALIDATION_FAILED", result.failMessage || "Validation failed", 400, nodeId);
      }
      if (result.halt) break;
      for (const edge of next) queue.push(edge.target);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Node failed";
      const status = isAppError(error) ? error.status : 400;
      logs.push({
        nodeId,
        nodeType: node.type,
        label: node.data.label,
        status: "error",
        input: clip(node.data.config),
        output: null,
        error: message,
        durationMs: Date.now() - nodeStarted,
      });
      return fail(isAppError(error) ? error.code : "WORKFLOW_NODE_FAILED", message, status, nodeId);
    }
  }

  return {
    status: "success",
    response: response ?? { statusCode: 200, body: { ok: true } },
    logs,
    durationMs: Date.now() - started,
  };
}
