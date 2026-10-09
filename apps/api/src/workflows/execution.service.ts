import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { assertSafeUrl } from "@foundry/shared/server";
import { AppError, type FieldDef, type WorkflowDef } from "@foundry/shared";
import { executeWorkflow, type DataPort, type HttpPort, type TriggerInput, type WorkflowResult } from "@foundry/workflow-engine";
import { Model, Types } from "mongoose";
import { Execution, NodeExecution } from "../database/schemas";
import { UsageService } from "../platform/platform.module";
import type { ModelRef } from "../records/records.service";
import { RecordsService } from "../records/records.service";

const SECRET = /pass|secret|token|authorization|api[-_]?key|cookie/i;

function scrub(value: unknown, secrets: string[], depth = 0): unknown {
  if (depth > 5) return "[max-depth]";
  if (typeof value === "string") {
    let next = value;
    for (const secret of secrets) {
      if (secret.length >= 6) next = next.split(secret).join("[redacted]");
    }
    return next.length > 4_000 ? `${next.slice(0, 4_000)}…` : next;
  }
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => scrub(item, secrets, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET.test(key) ? "[redacted]" : scrub(entry, secrets, depth + 1);
    }
    return output;
  }
  return value;
}

@Injectable()
export class ExecutionService {
  constructor(
    private readonly records: RecordsService,
    private readonly usage: UsageService,
    @InjectModel(Execution.name) private readonly executions: Model<Execution>,
    @InjectModel(NodeExecution.name) private readonly nodes: Model<NodeExecution>,
  ) {}

  port(projectId: string, models: Array<ModelRef & { slug?: string; name?: string }>): DataPort {
    const resolve = (ref: string) => {
      const model = models.find((item) => item.id === ref || item.slug === ref || item.name === ref);
      if (!model) throw new AppError("NOT_FOUND", "Collection not found", 404);
      return model;
    };
    return {
      findMany: (input) => this.records.list(projectId, resolve(input.modelId), input),
      findOne: (input) => this.records.findOne(projectId, resolve(input.modelId), input),
      create: (input) => this.records.create(projectId, resolve(input.modelId), input.data),
      update: (input) => this.records.update(projectId, resolve(input.modelId), input.id, input.data),
      delete: (input) => this.records.remove(projectId, resolve(input.modelId), input.id),
      count: (input) => this.records.count(projectId, resolve(input.modelId), input.filters),
      countBy: (input) => this.records.countBy(projectId, resolve(input.modelId), input.field),
    };
  }

  http(projectId: string, connections: ConnectionRuntime[]): HttpPort {
    return {
      resolveConnection: async (id) => connections.find((item) => item.id === id) ?? null,
      request: (input) => safeRequest(input),
    };
  }

  async run(options: {
    workflow: WorkflowDef;
    workflowId?: string | null;
    projectId: string;
    organizationId: string;
    models: Array<ModelRef & { slug?: string; name?: string }>;
    trigger: TriggerInput;
    secrets: Record<string, string>;
    env: Record<string, string>;
    connections?: ConnectionRuntime[];
    userId?: string | null;
    source: string;
  }): Promise<WorkflowResult & { executionId: string }> {
    const result = await executeWorkflow({
      workflow: options.workflow,
      projectId: options.projectId,
      trigger: options.trigger,
      data: this.port(options.projectId, options.models),
      http: this.http(options.projectId, options.connections ?? []),
      ai: process.env.OPENAI_API_KEY
        ? {
            complete: async (prompt) => completePrompt(prompt),
          }
        : undefined,
      secrets: options.secrets,
      env: options.env,
    });
    const secretValues = Object.values(options.secrets);
    const execution = await this.executions.create({
      projectId: new Types.ObjectId(options.projectId),
      workflowId: options.workflowId && Types.ObjectId.isValid(options.workflowId) ? new Types.ObjectId(options.workflowId) : null,
      source: options.source,
      status: result.status,
      durationMs: result.durationMs,
      responseStatus: result.response.statusCode,
      error: result.error ?? null,
      userId: options.userId && Types.ObjectId.isValid(options.userId) ? new Types.ObjectId(options.userId) : null,
    });
    if (result.logs.length) {
      await this.nodes.insertMany(
        result.logs.map((log, order) => ({
          executionId: execution._id,
          projectId: new Types.ObjectId(options.projectId),
          nodeId: log.nodeId,
          nodeType: log.nodeType,
          label: log.label,
          status: log.status,
          input: scrub(log.input, secretValues),
          output: scrub(log.output, secretValues),
          error: log.error ?? "",
          durationMs: log.durationMs,
          order,
        })),
        { ordered: true },
      );
    }
    await this.usage.increment(options.organizationId, options.projectId, "workflowExecutions");
    if (options.source === "api") await this.usage.increment(options.organizationId, options.projectId, "apiCalls");
    return {
      ...result,
      logs: result.logs.map((log) => ({
        ...log,
        input: scrub(log.input, secretValues),
        output: scrub(log.output, secretValues),
      })),
      executionId: String(execution._id),
    };
  }

  async list(projectId: string, limit = 30) {
    const rows = await this.executions
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 100))
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      workflowId: row.workflowId ? String(row.workflowId) : null,
      source: row.source,
      status: row.status,
      durationMs: row.durationMs,
      responseStatus: row.responseStatus,
      error: row.error,
      startedAt: row.startedAt,
    }));
  }

  async detail(projectId: string, executionId: string) {
    const execution = await this.executions.findOne({ _id: executionId, projectId }).lean();
    if (!execution) throw new AppError("NOT_FOUND", "Execution not found", 404);
    const logs = await this.nodes.find({ executionId: execution._id }).sort({ order: 1 }).lean();
    return {
      id: String(execution._id),
      status: execution.status,
      durationMs: execution.durationMs,
      responseStatus: execution.responseStatus,
      error: execution.error,
      source: execution.source,
      startedAt: execution.startedAt,
      logs: logs.map((log) => ({
        nodeId: log.nodeId,
        nodeType: log.nodeType,
        label: log.label,
        status: log.status,
        input: log.input,
        output: log.output,
        error: log.error,
        durationMs: log.durationMs,
      })),
    };
  }
}

export interface ConnectionRuntime {
  id: string;
  baseUrl: string;
  headers: Record<string, string>;
}

async function safeRequest(input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}) {
  let current = await assertSafeUrl(input.url);
  const headers = new Headers();
  for (const [key, value] of Object.entries(input.headers)) {
    if (/^(host|content-length|connection|transfer-encoding)$/i.test(key)) continue;
    headers.set(key, value);
  }
  const method = input.method.toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD" && input.body != null) {
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(current, { method, headers, body, redirect: "manual", signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) break;
        current = await assertSafeUrl(new URL(location, current).toString());
        if (response.status === 303) body = undefined;
        continue;
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      if (reader) {
        while (true) {
          const step = await reader.read();
          if (step.done) break;
          received += step.value.byteLength;
          if (received > 1_000_000) throw new AppError("PAYLOAD_TOO_LARGE", "Response is too large", 413);
          chunks.push(step.value);
        }
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      let parsed: unknown = text;
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("json") && text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return { status: response.status, headers: responseHeaders, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AppError("HTTP_REQUEST_FAILED", "Too many redirects", 400);
}

async function completePrompt(prompt: string): Promise<{ text: string; tokens: number }> {
  const response = await fetch(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "Reply with only the requested text." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new AppError("AI_PROVIDER_ERROR", "The AI provider rejected the prompt", 502);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
  return { text: json.choices?.[0]?.message?.content ?? "", tokens: json.usage?.total_tokens ?? 0 };
}

export { scrub };
