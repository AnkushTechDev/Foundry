import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { JwtService } from "@nestjs/jwt";
import {
  AppError,
  TEMPLATES,
  blueprintSchema,
  fieldKey,
  type FieldDef,
  type WorkflowDef,
} from "@foundry/shared";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { Model, Types } from "mongoose";
import { ApiDefinition, ApiKey, AppUser, Project, Workflow } from "../database/schemas";
import { ModelsService } from "../models/models.service";
import { PagesService } from "../builder/content.service";
import { ExecutionService } from "../workflows/execution.service";
import { ResourcesService } from "../resources/resources.service";
import type { ModelRef } from "../records/records.service";

interface SnapshotApi {
  id: string;
  name: string;
  method: string;
  path: string;
  auth: "public" | "authenticated" | "role" | "apiKey";
  roles: string[];
  workflowId: string;
  workflow: WorkflowDef | null;
}

interface Snapshot {
  project: { id: string; name: string; slug: string; authEnabled: boolean; organizationId: string; organizationSlug: string };
  models: Array<ModelRef & { name: string; slug: string }>;
  apis: SnapshotApi[];
  pages: Array<Record<string, unknown>>;
  connections: Array<{ id: string; baseUrl: string; authType: string; headerName: string; secretId: string | null; headers: Array<{ key: string; value: string }> }>;
}

function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const left = pattern.split("/").filter(Boolean);
  const right = actual.split("?")[0]?.split("/").filter(Boolean) ?? [];
  if (left.length !== right.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < left.length; index += 1) {
    const token = left[index] ?? "";
    const value = right[index] ?? "";
    if (token.startsWith(":")) params[token.slice(1)] = decodeURIComponent(value);
    else if (token !== value) return null;
  }
  return params;
}

@Injectable()
export class RuntimeService {
  constructor(
    @InjectModel(ApiDefinition.name) private readonly apis: Model<ApiDefinition>,
    @InjectModel(Workflow.name) private readonly workflows: Model<Workflow>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(ApiKey.name) private readonly keys: Model<ApiKey>,
    @InjectModel(AppUser.name) private readonly appUsers: Model<AppUser>,
    private readonly models: ModelsService,
    private readonly pages: PagesService,
    private readonly execution: ExecutionService,
    private readonly resources: ResourcesService,
    private readonly jwt: JwtService,
  ) {}

  async manifest(projectId: string, published: boolean) {
    if (!published) {
      const project = await this.projects.findById(projectId).lean();
      if (!project) throw new AppError("NOT_FOUND", "Project not found", 404);
      const pages = await this.pages.list(projectId);
      const full = await Promise.all(pages.map((page) => this.pages.get(projectId, page.id)));
      return { project: { id: projectId, name: project.name, authEnabled: project.authEnabled }, pages: full, published: false };
    }
    const snapshot = (await this.resources.currentSnapshot(projectId)) as Snapshot | null;
    if (!snapshot) throw new AppError("NOT_FOUND", "This app has not been published", 404);
    return { project: snapshot.project, pages: snapshot.pages, published: true };
  }

  async publishedManifest(orgSlug: string, projectSlug: string) {
    const project = await this.projects.findOne().populate({ path: "organizationId", select: "slug" });
    void project;
    const rows = await this.projects.aggregate<{ _id: Types.ObjectId }>([
      { $lookup: { from: "organizations", localField: "organizationId", foreignField: "_id", as: "org" } },
      { $match: { slug: projectSlug, "org.slug": orgSlug } },
      { $limit: 1 },
      { $project: { _id: 1 } },
    ]);
    const id = rows[0]?._id ? String(rows[0]._id) : "";
    if (!id) throw new AppError("NOT_FOUND", "Published app not found", 404);
    const manifest = await this.manifest(id, true);
    return { ...manifest, projectId: id };
  }

  async invoke(options: {
    projectId: string;
    organizationId: string;
    method: string;
    path: string;
    body: unknown;
    query: Record<string, unknown>;
    headers: Record<string, string>;
    published: boolean;
    platformUserId?: string;
  }) {
    const context = options.published ? await this.publishedContext(options.projectId) : await this.draftContext(options.projectId);
    if (options.path === "/openapi.json" && options.method === "GET") {
      return { statusCode: 200, body: openApi(context.projectName, context.apis) };
    }
    if (options.path.startsWith("/auth/")) {
      return this.appAuth(options, context.authEnabled);
    }
    const match = pick(context.apis, options.method, options.path);
    if (!match?.workflow) throw new AppError("NOT_FOUND", "API route not found", 404);
    await this.authorize(match, options);
    const environment = options.published ? "production" : "development";
    const [secrets, env, connections] = await Promise.all([
      this.resources.secretMap(options.projectId, environment),
      this.resources.envMap(options.projectId, environment),
      this.resources.connectionRuntime(options.projectId),
    ]);
    const result = await this.execution.run({
      workflow: match.workflow,
      workflowId: match.workflowId,
      projectId: options.projectId,
      organizationId: options.organizationId,
      models: context.models,
      connections,
      secrets,
      env,
      userId: options.platformUserId,
      source: options.path.includes("/hooks/") ? "webhook" : "api",
      trigger: {
        body: options.body ?? {},
        query: options.query,
        params: match.params,
        headers: options.headers,
        method: options.method,
        path: options.path,
      },
    });
    return { ...result.response, executionId: result.executionId, logs: options.published ? undefined : result.logs, status: result.status };
  }

  private async draftContext(projectId: string) {
    const project = await this.projects.findById(projectId).lean();
    if (!project) throw new AppError("NOT_FOUND", "Project not found", 404);
    const [models, apis] = await Promise.all([
      this.models.list(projectId),
      this.apis.find({ projectId: new Types.ObjectId(projectId) }).lean(),
    ]);
    const workflows = await this.workflows.find({ _id: { $in: apis.map((api) => api.workflowId) } }).lean();
    const byId = new Map(workflows.map((workflow) => [String(workflow._id), workflow]));
    return {
      projectName: project.name,
      authEnabled: project.authEnabled,
      organizationId: String(project.organizationId),
      models,
      apis: apis.map((api) => ({
        method: api.method,
        path: api.path,
        auth: api.auth,
        roles: api.roles,
        workflowId: String(api.workflowId),
        workflow: byId.has(String(api.workflowId))
          ? {
              name: byId.get(String(api.workflowId))!.name,
              nodes: byId.get(String(api.workflowId))!.nodes as WorkflowDef["nodes"],
              edges: byId.get(String(api.workflowId))!.edges as WorkflowDef["edges"],
            }
          : null,
      })),
    };
  }

  private async publishedContext(projectId: string) {
    const snapshot = (await this.resources.currentSnapshot(projectId)) as Snapshot | null;
    if (!snapshot) throw new AppError("NOT_FOUND", "This app has not been published", 404);
    return {
      projectName: snapshot.project.name,
      authEnabled: snapshot.project.authEnabled,
      organizationId: snapshot.project.organizationId,
      models: snapshot.models,
      apis: snapshot.apis,
    };
  }

  private async authorize(api: { auth: string; roles: string[] }, options: { projectId: string; headers: Record<string, string>; platformUserId?: string }) {
    if (api.auth === "public") return;
    if (options.platformUserId && !options.headers["x-foundry-published"]) return;
    const headerKey = options.headers["x-api-key"];
    const bearer = options.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const apiKey = headerKey || (bearer.startsWith("fk_") ? bearer : "");
    if (api.auth === "apiKey" || apiKey) {
      if (!apiKey) throw new AppError("UNAUTHORIZED", "API key is required", 401);
      const hash = createHash("sha256").update(apiKey).digest("hex");
      const found = await this.keys.findOne({ projectId: options.projectId, hash, revokedAt: null }).lean();
      if (!found) throw new AppError("UNAUTHORIZED", "API key is invalid", 401);
      return;
    }
    if (!bearer) throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    try {
      const payload = await this.jwt.verifyAsync<{ projectId: string; role: string; kind: string }>(bearer, {
        secret: process.env.JWT_APP_SECRET ?? "dev-app-secret-change-me",
      });
      if (payload.kind !== "app" || payload.projectId !== options.projectId) throw new Error("mismatch");
      if (api.auth === "role" && payload.role !== "admin" && !api.roles.includes(payload.role)) {
        throw new AppError("FORBIDDEN", "This action requires a different role", 403);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("UNAUTHORIZED", "Authentication required", 401);
    }
  }

  private async appAuth(options: { projectId: string; path: string; method: string; body: unknown }, authEnabled: boolean) {
    if (!authEnabled) throw new AppError("NOT_FOUND", "App authentication is disabled", 404);
    const body = (options.body ?? {}) as { email?: string; password?: string; name?: string };
    if (options.path === "/auth/register" && options.method === "POST") {
      if (!body.email || !body.password || !body.name) throw new AppError("VALIDATION_FAILED", "Name, email, and password are required");
      const passwordHash = await bcrypt.hash(body.password, 12);
      const user = await this.appUsers.create({
        projectId: new Types.ObjectId(options.projectId),
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash,
        role: "member",
      });
      return { statusCode: 201, body: { token: await this.appToken(options.projectId, String(user._id), user.email, user.role), user: { id: String(user._id), email: user.email, name: user.name, role: user.role } } };
    }
    if (options.path === "/auth/login" && options.method === "POST") {
      const user = await this.appUsers.findOne({ projectId: options.projectId, email: body.email?.toLowerCase() }).select("+passwordHash");
      if (!user || !body.password || !(await bcrypt.compare(body.password, user.passwordHash))) {
        throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect", 401);
      }
      return { statusCode: 200, body: { token: await this.appToken(options.projectId, String(user._id), user.email, user.role), user: { id: String(user._id), email: user.email, name: user.name, role: user.role } } };
    }
    throw new AppError("NOT_FOUND", "Auth route not found", 404);
  }

  private appToken(projectId: string, userId: string, email: string, role: string) {
    return this.jwt.signAsync(
      { sub: userId, email, role, projectId, kind: "app" },
      { secret: process.env.JWT_APP_SECRET ?? "dev-app-secret-change-me", expiresIn: "7d" },
    );
  }
}

function pick(apis: Array<{ method: string; path: string; auth: string; roles: string[]; workflowId: string; workflow: WorkflowDef | null }>, method: string, path: string) {
  let best: { score: number; params: Record<string, string>; api: (typeof apis)[number] } | null = null;
  for (const api of apis) {
    if (api.method !== method.toUpperCase()) continue;
    const params = matchPath(api.path, path);
    if (!params) continue;
    const score = api.path.split("/").filter((part) => part && !part.startsWith(":")).length;
    if (!best || score > best.score) best = { score, params, api };
  }
  return best ? { ...best.api, params: best.params } : null;
}

function openApi(title: string, apis: Array<{ method: string; path: string; name?: string }>) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const api of apis) {
    const path = api.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    paths[path] ??= {};
    paths[path][api.method.toLowerCase()] = {
      summary: api.name ?? `${api.method} ${api.path}`,
      responses: { "200": { description: "Success" } },
    };
  }
  return { openapi: "3.0.3", info: { title, version: "1.0.0" }, paths };
}

function inferType(name: string): FieldDef["type"] {
  const lower = name.toLowerCase();
  if (/(date|close)/.test(lower)) return "date";
  if (/(price|value|salary|stock|amount|total|count)/.test(lower)) return "number";
  if (/(active|enabled|done|published)/.test(lower)) return "boolean";
  if (lower === "status" || lower === "priority" || lower === "stage") return "enum";
  return "string";
}

export function planBlueprint(prompt: string) {
  const models: Array<{ name: string; fields: Array<Omit<FieldDef, "id"> & { id?: string }> }> = [];
  const pattern = /([A-Za-z][A-Za-z ]{1,40}?)\s+(?:should\s+)?have\s+([^.]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prompt))) {
    const name = (match[1] ?? "").trim().replace(/^(create|manage|and)\s+/i, "").replace(/\s+/g, " ");
    const cleanName = name.split(" ").filter((part) => part[0] === part[0]?.toUpperCase()).slice(-2).join(" ") || name;
    const fields = (match[2] ?? "")
      .split(/,| and /i)
      .map((part) => part.trim().replace(/\.$/, ""))
      .filter((part) => part.length > 1 && part.length < 40);
    if (!cleanName || fields.length === 0) continue;
    models.push({
      name: cleanName.replace(/s$/, (ending, offset, source) => (source.length > 4 && /ies$/.test(source) ? source : source.endsWith("s") ? source.slice(0, -1) : source)),
      fields: fields.map((fieldName) => {
        const type = inferType(fieldName);
        return {
          name: fieldName.replace(/\b\w/g, (char) => char.toUpperCase()),
          key: fieldKey(fieldName),
          type,
          required: /name|email|title|subject/.test(fieldName.toLowerCase()),
          unique: fieldName.toLowerCase().includes("email") || fieldName.toLowerCase() === "sku",
          index: fieldName.toLowerCase().includes("email"),
          enumValues: type === "enum" ? ["open", "active", "closed"] : undefined,
        };
      }),
    });
  }
  if (models.length === 0) {
    const template = TEMPLATES.find((item) => prompt.toLowerCase().includes(item.id) || prompt.toLowerCase().includes(item.name.toLowerCase()));
    if (template) {
      return blueprintSchema.parse({
        projectName: template.name,
        description: template.description,
        models: template.models.map((model) => ({ name: model.name, fields: model.fields })),
        includeCrud: true,
      });
    }
    models.push({
      name: "Customer",
      fields: ["Name", "Email", "Phone", "Company", "Status"].map((name) => ({
        name,
        key: fieldKey(name),
        type: inferType(name),
        required: name === "Name" || name === "Email",
        unique: name === "Email",
        index: name === "Email",
        enumValues: name === "Status" ? ["new", "active", "archived"] : undefined,
      })),
    });
  }
  const projectName = models.length > 1 ? `${models[0]?.name ?? "App"} workspace` : `${models[0]?.name ?? "App"} manager`;
  return blueprintSchema.parse({ projectName, description: prompt.slice(0, 240), models, includeCrud: true });
}

@Injectable()
export class AiService {
  constructor(private readonly models: ModelsService) {}

  async generate(projectId: string, organizationId: string, userId: string, prompt: string) {
    const blueprint = await this.produce(prompt);
    const created = [];
    for (const draft of blueprint.models) {
      const fields = draft.fields.map((field) => ({
        ...field,
        id: field.id ?? crypto.randomUUID(),
        key: field.key || fieldKey(field.name),
        required: field.required ?? false,
        unique: field.unique ?? false,
        index: field.index ?? false,
      }));
      const model = await this.models.create(projectId, organizationId, userId, { name: draft.name, fields });
      const apis = blueprint.includeCrud ? await this.models.generate(projectId, organizationId, userId, model.id) : { apis: [] };
      const page = await this.models.generatePage(projectId, model.id);
      created.push({ model, apis: apis.apis, page });
    }
    return { projectName: blueprint.projectName, created };
  }

  private async produce(prompt: string) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return planBlueprint(prompt);
    const system = "You design metadata for a visual app builder. Return JSON only with projectName, description, includeCrud, and models. Each model has name and fields. Field types must be one of string, number, boolean, date, object, array, reference, enum. Include key, required, unique. Do not invent executable code.";
    let content = await askModel(system, prompt);
    let parsed = blueprintSchema.safeParse(readJson(content));
    if (!parsed.success) {
      content = await askModel(system, `The previous JSON failed validation: ${parsed.error.message}. Repair it. Prompt: ${prompt}`);
      parsed = blueprintSchema.safeParse(readJson(content));
    }
    return parsed.success ? parsed.data : planBlueprint(prompt);
  }
}

function readJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
}

async function askModel(system: string, prompt: string): Promise<string> {
  const response = await fetch(`${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!response.ok) return "{}";
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "{}";
}
