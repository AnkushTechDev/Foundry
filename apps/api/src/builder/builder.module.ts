import { All, Body, Controller, Delete, Get, Module, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ApiTags } from "@nestjs/swagger";
import { AppError, workflowSchema } from "@foundry/shared";
import type { Response } from "express";
import { Model } from "mongoose";
import { z } from "zod";
import { JwtAuthGuard, ProjectGuard, ProjectRoles } from "../common/guards";
import { RawResponse } from "../common/http";
import type { AuthedRequest } from "../common/request";
import { PagesService, WorkflowsService } from "../builder/content.service";
import { ApiDefinition, Execution } from "../database/schemas";
import { ModelsService } from "../models/models.service";
import { AuditService, UsageService } from "../platform/platform.module";
import { RecordsService } from "../records/records.service";
import { ResourcesService } from "../resources/resources.service";
import { AiService, RuntimeService } from "../runtime/runtime.service";
import { TenancyService } from "../tenancy/tenancy.service";
import { ExecutionService } from "../workflows/execution.service";
import { AuthModule } from "../auth/auth.module";
import { TenancyModule } from "../tenancy/tenancy.module";

function queryOf(value: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) query[key] = Array.isArray(entry) ? entry[0] : entry;
  return query;
}

function headersOf(headers: AuthedRequest["headers"]): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key === "cookie") continue;
    if (typeof value === "string") output[key.toLowerCase()] = value;
  }
  return output;
}

function tail(url: string, marker: string): string {
  const path = (url.split("?")[0] ?? "/");
  const index = path.indexOf(marker);
  const rest = index >= 0 ? path.slice(index + marker.length) : "/";
  return rest.startsWith("/") ? rest || "/" : `/${rest}`;
}

@ApiTags("project")
@Controller("projects/:projectId")
@UseGuards(JwtAuthGuard, ProjectGuard)
class ProjectController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly models: ModelsService,
    private readonly records: RecordsService,
    private readonly workflows: WorkflowsService,
    private readonly pages: PagesService,
    private readonly execution: ExecutionService,
    private readonly resources: ResourcesService,
    private readonly ai: AiService,
    private readonly audit: AuditService,
    private readonly runtime: RuntimeService,
    @InjectModel(ApiDefinition.name) private readonly apis: Model<ApiDefinition>,
    @InjectModel(Execution.name) private readonly executions: Model<Execution>,
  ) {}

  @Get()
  async overview(@Req() req: AuthedRequest) {
    const projectId = req.projectContext!.id;
    const [models, apis, pages, workflows, versions] = await Promise.all([
      this.models.list(projectId),
      this.apis.countDocuments({ projectId }),
      this.pages.list(projectId),
      this.workflows.list(projectId),
      this.resources.listVersions(projectId),
    ]);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const errors = await this.executions.countDocuments({ projectId, status: "error", startedAt: { $gte: since } });
    return { project: { ...req.projectContext, role: req.memberRole }, counts: { models: models.length, apis, pages: pages.length, workflows: workflows.length, errors }, versions };
  }

  @Patch()
  @ProjectRoles("member")
  async update(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = z.object({
      name: z.string().min(2).max(80).optional(),
      description: z.string().max(400).optional(),
      authEnabled: z.boolean().optional(),
    }).parse(body);
    await this.tenancy.updateProject(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, parsed);
    return { ok: true };
  }

  @Get("models")
  modelsList(@Req() req: AuthedRequest) {
    return this.models.list(req.projectContext!.id);
  }

  @Post("models")
  @ProjectRoles("member")
  createModel(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.models.create(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, body);
  }

  @Patch("models/:modelId")
  @ProjectRoles("member")
  updateModel(@Req() req: AuthedRequest, @Param("modelId") modelId: string, @Body() body: unknown) {
    return this.models.update(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, modelId, body);
  }

  @Delete("models/:modelId")
  @ProjectRoles("admin")
  deleteModel(@Req() req: AuthedRequest, @Param("modelId") modelId: string) {
    return this.models.remove(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, modelId);
  }

  @Post("models/:modelId/generate")
  @ProjectRoles("member")
  generate(@Req() req: AuthedRequest, @Param("modelId") modelId: string, @Body() body: unknown) {
    const mode = z.object({ mode: z.enum(["crud", "upsert"]).default("crud"), page: z.boolean().default(true) }).parse(body ?? {});
    return this.generateModel(req, modelId, mode.mode, mode.page);
  }

  @Get("models/:modelId/records")
  async recordsList(@Req() req: AuthedRequest, @Param("modelId") modelId: string, @Query("limit") limit?: string) {
    const model = await this.models.get(req.projectContext!.id, modelId);
    const items = await this.records.list(req.projectContext!.id, model, { limit: Number(limit ?? 50) });
    return { items };
  }

  @Post("models/:modelId/records")
  @ProjectRoles("member")
  async createRecord(@Req() req: AuthedRequest, @Param("modelId") modelId: string, @Body() body: unknown) {
    const model = await this.models.get(req.projectContext!.id, modelId);
    return this.records.create(req.projectContext!.id, model, body);
  }

  @Patch("models/:modelId/records/:recordId")
  @ProjectRoles("member")
  async updateRecord(@Req() req: AuthedRequest, @Param("modelId") modelId: string, @Param("recordId") recordId: string, @Body() body: unknown) {
    const model = await this.models.get(req.projectContext!.id, modelId);
    const row = await this.records.update(req.projectContext!.id, model, recordId, body);
    if (!row) throw new AppError("NOT_FOUND", "Record not found", 404);
    return row;
  }

  @Delete("models/:modelId/records/:recordId")
  @ProjectRoles("member")
  async deleteRecord(@Req() req: AuthedRequest, @Param("modelId") modelId: string, @Param("recordId") recordId: string) {
    const model = await this.models.get(req.projectContext!.id, modelId);
    const deleted = await this.records.remove(req.projectContext!.id, model, recordId);
    if (!deleted) throw new AppError("NOT_FOUND", "Record not found", 404);
    return { deleted: true };
  }

  @Get("apis")
  async apisList(@Req() req: AuthedRequest) {
    const rows = await this.apis.find({ projectId: req.projectContext!.id }).sort({ path: 1 }).lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      method: row.method,
      path: row.path,
      auth: row.auth,
      roles: row.roles,
      workflowId: String(row.workflowId),
    }));
  }

  @Patch("apis/:apiId")
  @ProjectRoles("member")
  async updateApi(@Req() req: AuthedRequest, @Param("apiId") apiId: string, @Body() body: unknown) {
    const parsed = z.object({
      auth: z.enum(["public", "authenticated", "role", "apiKey"]).optional(),
      roles: z.array(z.string()).optional(),
      name: z.string().min(1).max(80).optional(),
    }).parse(body);
    const row = await this.apis.findOneAndUpdate({ _id: apiId, projectId: req.projectContext!.id }, { $set: parsed }, { new: true }).lean();
    if (!row) throw new AppError("NOT_FOUND", "API not found", 404);
    return { id: String(row._id), auth: row.auth, name: row.name };
  }

  @Post("apis/:apiId/test")
  @ProjectRoles("member")
  async testApi(@Req() req: AuthedRequest, @Param("apiId") apiId: string, @Body() body: unknown) {
    const parsed = z.object({
      params: z.record(z.string()).optional(),
      query: z.record(z.string()).optional(),
      headers: z.record(z.string()).optional(),
      body: z.unknown().optional(),
    }).parse(body ?? {});
    const api = await this.apis.findOne({ _id: apiId, projectId: req.projectContext!.id }).lean();
    if (!api) throw new AppError("NOT_FOUND", "API not found", 404);
    const workflow = await this.workflows.get(req.projectContext!.id, String(api.workflowId));
    const models = await this.models.list(req.projectContext!.id);
    const result = await this.execution.run({
      workflow,
      workflowId: workflow.id,
      projectId: req.projectContext!.id,
      organizationId: req.projectContext!.organizationId,
      models,
      secrets: await this.resources.secretMap(req.projectContext!.id, "development"),
      env: await this.resources.envMap(req.projectContext!.id, "development"),
      connections: await this.resources.connectionRuntime(req.projectContext!.id),
      userId: req.authUser!.id,
      source: "manual",
      trigger: { body: parsed.body ?? {}, query: parsed.query ?? {}, params: parsed.params ?? {}, headers: parsed.headers ?? {}, method: api.method, path: api.path },
    });
    return { statusCode: result.response.statusCode, body: result.response.body, durationMs: result.durationMs, executionId: result.executionId, logs: result.logs, status: result.status };
  }

  @Get("workflows")
  workflowList(@Req() req: AuthedRequest) {
    return this.workflows.list(req.projectContext!.id);
  }

  @Post("workflows")
  @ProjectRoles("member")
  createWorkflow(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.workflows.save(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, null, body);
  }

  @Get("workflows/:workflowId")
  getWorkflow(@Req() req: AuthedRequest, @Param("workflowId") workflowId: string) {
    return this.workflows.get(req.projectContext!.id, workflowId);
  }

  @Patch("workflows/:workflowId")
  @ProjectRoles("member")
  saveWorkflow(@Req() req: AuthedRequest, @Param("workflowId") workflowId: string, @Body() body: unknown) {
    return this.workflows.save(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, workflowId, body);
  }

  @Delete("workflows/:workflowId")
  @ProjectRoles("member")
  deleteWorkflow(@Req() req: AuthedRequest, @Param("workflowId") workflowId: string) {
    return this.workflows.remove(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, workflowId);
  }

  @Post("workflows/:workflowId/execute")
  @ProjectRoles("member")
  async execute(@Req() req: AuthedRequest, @Param("workflowId") workflowId: string, @Body() body: unknown) {
    const parsed = z.object({ body: z.unknown().optional(), query: z.record(z.string()).optional(), params: z.record(z.string()).optional() }).parse(body ?? {});
    const workflow = await this.workflows.get(req.projectContext!.id, workflowId);
    workflowSchema.parse(workflow);
    const result = await this.execution.run({
      workflow,
      workflowId,
      projectId: req.projectContext!.id,
      organizationId: req.projectContext!.organizationId,
      models: await this.models.list(req.projectContext!.id),
      secrets: await this.resources.secretMap(req.projectContext!.id, "development"),
      env: await this.resources.envMap(req.projectContext!.id, "development"),
      connections: await this.resources.connectionRuntime(req.projectContext!.id),
      userId: req.authUser!.id,
      source: "manual",
      trigger: { body: parsed.body ?? {}, query: parsed.query ?? {}, params: parsed.params ?? {} },
    });
    return { statusCode: result.response.statusCode, body: result.response.body, durationMs: result.durationMs, executionId: result.executionId, logs: result.logs, status: result.status };
  }

  @Get("pages")
  pageList(@Req() req: AuthedRequest) {
    return this.pages.list(req.projectContext!.id);
  }

  @Post("pages")
  @ProjectRoles("member")
  createPage(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.pages.save(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, null, body);
  }

  @Get("pages/:pageId")
  getPage(@Req() req: AuthedRequest, @Param("pageId") pageId: string) {
    return this.pages.get(req.projectContext!.id, pageId);
  }

  @Patch("pages/:pageId")
  @ProjectRoles("member")
  savePage(@Req() req: AuthedRequest, @Param("pageId") pageId: string, @Body() body: unknown) {
    return this.pages.save(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, pageId, body);
  }

  @Delete("pages/:pageId")
  @ProjectRoles("member")
  deletePage(@Req() req: AuthedRequest, @Param("pageId") pageId: string) {
    return this.pages.remove(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, pageId);
  }

  @Get("executions")
  executionsList(@Req() req: AuthedRequest) {
    return this.execution.list(req.projectContext!.id);
  }

  @Get("executions/:executionId")
  executionDetail(@Req() req: AuthedRequest, @Param("executionId") executionId: string) {
    return this.execution.detail(req.projectContext!.id, executionId);
  }

  @Get("data-sources")
  sources(@Req() req: AuthedRequest) {
    return this.resources.listSources(req.projectContext!.id);
  }

  @Post("data-sources")
  @ProjectRoles("member")
  createSource(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.resources.saveSource(req.projectContext!.id, body);
  }

  @Get("connections")
  connections(@Req() req: AuthedRequest) {
    return this.resources.listConnections(req.projectContext!.id);
  }

  @Post("connections")
  @ProjectRoles("admin")
  createConnection(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.resources.saveConnection(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, body);
  }

  @Get("secrets")
  secrets(@Req() req: AuthedRequest) {
    return this.resources.listSecrets(req.projectContext!.id);
  }

  @Post("secrets")
  @ProjectRoles("admin")
  createSecret(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.resources.createSecret(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, body);
  }

  @Delete("secrets/:secretId")
  @ProjectRoles("admin")
  deleteSecret(@Req() req: AuthedRequest, @Param("secretId") secretId: string) {
    return this.resources.deleteSecret(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, secretId);
  }

  @Get("environments")
  environments(@Req() req: AuthedRequest) {
    return this.resources.ensureEnvironments(req.projectContext!.id);
  }

  @Patch("environments/:name")
  @ProjectRoles("admin")
  saveEnv(@Req() req: AuthedRequest, @Param("name") name: "development" | "production", @Body() body: unknown) {
    const parsed = z.object({ variables: z.array(z.object({ key: z.string(), value: z.string() })) }).parse(body);
    return this.resources.setVariables(req.projectContext!.id, name, parsed.variables);
  }

  @Get("api-keys")
  apiKeys(@Req() req: AuthedRequest) {
    return this.resources.listApiKeys(req.projectContext!.id);
  }

  @Post("api-keys")
  @ProjectRoles("admin")
  createKey(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = z.object({ name: z.string().min(1).max(80) }).parse(body);
    return this.resources.createApiKey(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, parsed.name);
  }

  @Post("api-keys/:keyId/revoke")
  @ProjectRoles("admin")
  revokeKey(@Req() req: AuthedRequest, @Param("keyId") keyId: string) {
    return this.resources.revokeApiKey(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, keyId);
  }

  @Get("deployments")
  deployments(@Req() req: AuthedRequest) {
    return this.resources.listVersions(req.projectContext!.id);
  }

  @Post("publish")
  @ProjectRoles("admin")
  publish(@Req() req: AuthedRequest) {
    return this.resources.publish(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id);
  }

  @Post("deployments/:versionId/rollback")
  @ProjectRoles("admin")
  rollback(@Req() req: AuthedRequest, @Param("versionId") versionId: string) {
    return this.resources.rollback(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, versionId);
  }

  @Get("audit")
  auditList(@Req() req: AuthedRequest) {
    return this.audit.list(req.projectContext!.id);
  }

  @Post("ai/generate")
  @ProjectRoles("member")
  generateAi(@Req() req: AuthedRequest, @Body() body: unknown) {
    const parsed = z.object({ prompt: z.string().min(8).max(4_000) }).parse(body);
    return this.ai.generate(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, parsed.prompt);
  }

  @Get("preview")
  preview(@Req() req: AuthedRequest) {
    return this.runtime.manifest(req.projectContext!.id, false);
  }

  private async generateModel(req: AuthedRequest, modelId: string, mode: "crud" | "upsert", page: boolean) {
    const apis = await this.models.generate(req.projectContext!.id, req.projectContext!.organizationId, req.authUser!.id, modelId, mode);
    const createdPage = page ? await this.models.generatePage(req.projectContext!.id, modelId) : null;
    return { ...apis, page: createdPage };
  }
}

@ApiTags("runtime")
@Controller("runtime")
class RuntimeController {
  constructor(
    private readonly runtime: RuntimeService,
    private readonly tenancy: TenancyService,
    private readonly workflows: WorkflowsService,
    private readonly execution: ExecutionService,
    private readonly models: ModelsService,
    private readonly resources: ResourcesService,
  ) {}

  @Get("apps/:orgSlug/:projectSlug/manifest")
  @RawResponse()
  manifest(@Param("orgSlug") orgSlug: string, @Param("projectSlug") projectSlug: string) {
    return this.runtime.publishedManifest(orgSlug, projectSlug);
  }

  @All("apps/:orgSlug/:projectSlug/*path")
  @RawResponse()
  async published(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @Param("orgSlug") orgSlug: string, @Param("projectSlug") projectSlug: string) {
    const manifest = await this.runtime.publishedManifest(orgSlug, projectSlug);
    const projectId = (manifest as { projectId: string }).projectId;
    const organizationId = (manifest.project as { organizationId?: string }).organizationId;
    const result = await this.runtime.invoke({
      projectId,
      organizationId: organizationId ?? "",
      method: req.method,
      path: tail(req.originalUrl, `/runtime/apps/${orgSlug}/${projectSlug}`),
      body: req.body,
      query: queryOf(req.query as Record<string, unknown>),
      headers: { ...headersOf(req.headers), "x-foundry-published": "1" },
      published: true,
    });
    res.status(result.statusCode);
    return result.body;
  }

  @All("projects/:projectId/draft/*path")
  @UseGuards(JwtAuthGuard)
  @RawResponse()
  async draft(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @Param("projectId") projectId: string) {
    const access = await this.tenancy.requireProject(req.authUser!.id, projectId, "viewer");
    const result = await this.runtime.invoke({
      projectId,
      organizationId: access.project.organizationId,
      method: req.method,
      path: tail(req.originalUrl, `/runtime/projects/${projectId}/draft`),
      body: req.body,
      query: queryOf(req.query as Record<string, unknown>),
      headers: headersOf(req.headers),
      published: false,
      platformUserId: req.authUser!.id,
    });
    res.status(result.statusCode);
    return result.body;
  }

  @Post("projects/:projectId/hooks/:workflowId")
  @RawResponse()
  async hook(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response, @Param("projectId") projectId: string, @Param("workflowId") workflowId: string) {
    const workflow = await this.workflows.get(projectId, workflowId);
    if (!workflow.nodes.some((node) => node.type === "webhookTrigger")) throw new AppError("NOT_FOUND", "Webhook not found", 404);
    const result = await this.execution.run({
      workflow,
      workflowId,
      projectId,
      organizationId: await this.tenancy.organizationIdFor(projectId),
      models: await this.models.list(projectId),
      secrets: await this.resources.secretMap(projectId, "production"),
      env: await this.resources.envMap(projectId, "production"),
      connections: await this.resources.connectionRuntime(projectId),
      source: "webhook",
      trigger: { body: req.body ?? {}, headers: headersOf(req.headers), method: "POST", path: `/hooks/${workflowId}` },
    });
    res.status(result.response.statusCode);
    return result.response.body;
  }
}

@Controller()
class CatalogController {
  constructor(
    private readonly resources: ResourcesService,
    private readonly usage: UsageService,
    private readonly tenancy: TenancyService,
    @InjectModel(Execution.name) private readonly executions: Model<Execution>,
  ) {}

  @Get("templates")
  templates() {
    return this.resources.templates();
  }

  @Post("templates/:templateId/use")
  @UseGuards(JwtAuthGuard)
  useTemplate(@Req() req: AuthedRequest, @Param("templateId") templateId: string, @Body() body: unknown) {
    const parsed = z.object({ organizationId: z.string(), name: z.string().min(2).max(80).optional() }).parse(body);
    return this.resources.applyTemplate(req.authUser!.id, templateId, parsed.organizationId, parsed.name);
  }

  @Get("dashboard")
  @UseGuards(JwtAuthGuard)
  async dashboard(@Req() req: AuthedRequest, @Query("organizationId") organizationId?: string) {
    const orgs = await this.tenancy.listOrganizations(req.authUser!.id);
    const orgId = organizationId || orgs[0]?.id;
    if (!orgId) return { organizations: [], projects: [], usage: null, errors: 0 };
    const [projects, usage] = await Promise.all([
      this.tenancy.listProjects(req.authUser!.id, orgId),
      this.usage.summary(orgId),
    ]);
    const errors = await this.executions.countDocuments({
      projectId: { $in: projects.map((project) => project.id) },
      status: "error",
    });
    return { organizations: orgs, projects, usage, errors };
  }
}

@Module({
  imports: [AuthModule, TenancyModule],
  controllers: [ProjectController, RuntimeController, CatalogController],
  providers: [
    ProjectGuard,
    ModelsService,
    RecordsService,
    WorkflowsService,
    PagesService,
    ExecutionService,
    ResourcesService,
    RuntimeService,
    AiService,
  ],
  exports: [ExecutionService, ModelsService, WorkflowsService, ResourcesService],
})
export class BuilderModule {}
