import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { AppError, PLANS, TEMPLATES, getTemplate, isSafeKey, type FieldDef, type WorkflowDef } from "@foundry/shared";
import { Model, Types } from "mongoose";
import { z } from "zod";
import { CryptoService } from "../common/crypto.service";
import {
  ApiDefinition,
  ApiKey,
  AppVersion,
  Connection,
  DataModel,
  DataSource,
  Environment,
  Organization,
  Page,
  Project,
  Secret,
  Workflow,
} from "../database/schemas";
import { ModelsService } from "../models/models.service";
import { AuditService, UsageService } from "../platform/platform.module";
import { TenancyService } from "../tenancy/tenancy.service";
import { fillComponent } from "../builder/content.service";

const secretSchema = z.object({
  environment: z.enum(["development", "production"]).default("development"),
  key: z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/),
  value: z.string().min(1).max(4_000),
});

@Injectable()
export class ResourcesService {
  constructor(
    @InjectModel(DataSource.name) private readonly sources: Model<DataSource>,
    @InjectModel(Connection.name) private readonly connections: Model<Connection>,
    @InjectModel(Secret.name) private readonly secrets: Model<Secret>,
    @InjectModel(ApiKey.name) private readonly keys: Model<ApiKey>,
    @InjectModel(Environment.name) private readonly environments: Model<Environment>,
    @InjectModel(AppVersion.name) private readonly versions: Model<AppVersion>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(Organization.name) private readonly organizations: Model<Organization>,
    @InjectModel(DataModel.name) private readonly models: Model<DataModel>,
    @InjectModel(ApiDefinition.name) private readonly apis: Model<ApiDefinition>,
    @InjectModel(Workflow.name) private readonly workflows: Model<Workflow>,
    @InjectModel(Page.name) private readonly pages: Model<Page>,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly modelService: ModelsService,
    private readonly tenancy: TenancyService,
  ) {}

  async ensureEnvironments(projectId: string) {
    for (const name of ["development", "production"] as const) {
      await this.environments.updateOne(
        { projectId: new Types.ObjectId(projectId), name },
        { $setOnInsert: { projectId: new Types.ObjectId(projectId), name, variables: [] } },
        { upsert: true },
      );
    }
    const rows = await this.environments.find({ projectId }).lean();
    return rows.map((row) => ({ id: String(row._id), name: row.name, variables: row.variables }));
  }

  async setVariables(projectId: string, name: "development" | "production", variables: Array<{ key: string; value: string }>) {
    const clean = variables
      .filter((item) => isSafeKey(item.key))
      .slice(0, 50)
      .map((item) => ({ key: item.key, value: String(item.value).slice(0, 2_000) }));
    await this.environments.updateOne({ projectId, name }, { $set: { variables: clean } });
    return { name, variables: clean };
  }

  async listSecrets(projectId: string) {
    const rows = await this.secrets.find({ projectId }).select("environment key createdAt").lean();
    return rows.map((row) => ({ id: String(row._id), environment: row.environment, key: row.key, createdAt: row.createdAt }));
  }

  async createSecret(projectId: string, organizationId: string, userId: string, input: unknown) {
    const parsed = secretSchema.parse(input);
    const encrypted = this.crypto.encrypt(parsed.value);
    const doc = await this.secrets.findOneAndUpdate(
      { projectId: new Types.ObjectId(projectId), environment: parsed.environment, key: parsed.key },
      { $set: encrypted },
      { upsert: true, new: true },
    );
    await this.audit.record({ organizationId, projectId, userId, action: "secret.changed", resource: "secret", resourceId: String(doc!._id), metadata: { key: parsed.key } });
    return { id: String(doc!._id), key: parsed.key, environment: parsed.environment };
  }

  async deleteSecret(projectId: string, organizationId: string, userId: string, secretId: string) {
    await this.secrets.deleteOne({ _id: secretId, projectId });
    await this.audit.record({ organizationId, projectId, userId, action: "secret.deleted", resource: "secret", resourceId: secretId });
    return { deleted: true };
  }

  async secretMap(projectId: string, environment: "development" | "production") {
    const rows = await this.secrets.find({ projectId, environment }).lean();
    const map: Record<string, string> = {};
    for (const row of rows) {
      try {
        map[row.key] = this.crypto.decrypt(row);
      } catch {
        // Skip secrets written with a different key rather than failing every run.
      }
    }
    return map;
  }

  async envMap(projectId: string, environment: "development" | "production") {
    const row = await this.environments.findOne({ projectId, name: environment }).lean();
    return Object.fromEntries((row?.variables ?? []).map((item) => [item.key, item.value]));
  }

  async listConnections(projectId: string) {
    const rows = await this.connections.find({ projectId }).lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      baseUrl: row.baseUrl,
      authType: row.authType,
      headerName: row.headerName,
      headers: row.headers,
      hasSecret: Boolean(row.secretId),
    }));
  }

  async saveConnection(projectId: string, organizationId: string, userId: string, input: unknown, connectionId?: string) {
    const parsed = z.object({
      name: z.string().min(1).max(80),
      baseUrl: z.string().url(),
      authType: z.enum(["none", "apiKey", "bearer", "basic"]).default("none"),
      headerName: z.string().max(80).optional(),
      headers: z.array(z.object({ key: z.string(), value: z.string() })).max(20).optional(),
      secret: z.string().max(4_000).optional(),
    }).parse(input);
    let secretId: Types.ObjectId | null = null;
    if (parsed.secret) {
      const encrypted = this.crypto.encrypt(parsed.secret);
      const secret = await this.secrets.create({
        projectId: new Types.ObjectId(projectId),
        environment: "development",
        key: `CONNECTION_${randomBytes(4).toString("hex").toUpperCase()}`,
        ...encrypted,
      });
      secretId = secret._id;
    }
    const payload = {
      name: parsed.name,
      baseUrl: parsed.baseUrl.replace(/\/$/, ""),
      authType: parsed.authType,
      headerName: parsed.headerName || (parsed.authType === "apiKey" ? "x-api-key" : "Authorization"),
      headers: parsed.headers ?? [],
      ...(secretId ? { secretId } : {}),
    };
    const doc = connectionId
      ? await this.connections.findOneAndUpdate({ _id: connectionId, projectId }, { $set: payload }, { new: true })
      : await this.connections.create({ ...payload, projectId: new Types.ObjectId(projectId) });
    if (!doc) throw new AppError("NOT_FOUND", "Connection not found", 404);
    await this.audit.record({ organizationId, projectId, userId, action: "connection.saved", resource: "connection", resourceId: String(doc._id) });
    return { id: String(doc._id), name: doc.name, baseUrl: doc.baseUrl, authType: doc.authType };
  }

  async connectionRuntime(projectId: string) {
    const rows = await this.connections.find({ projectId }).lean();
    const result = [];
    for (const row of rows) {
      const headers: Record<string, string> = {};
      for (const header of row.headers ?? []) headers[header.key] = header.value;
      if (row.secretId) {
        const secret = await this.secrets.findById(row.secretId).lean();
        if (secret) {
          const value = this.crypto.decrypt(secret);
          if (row.authType === "bearer") headers[row.headerName || "Authorization"] = `Bearer ${value}`;
          else if (row.authType === "basic") headers.Authorization = `Basic ${Buffer.from(value).toString("base64")}`;
          else if (row.authType === "apiKey") headers[row.headerName || "x-api-key"] = value;
        }
      }
      result.push({ id: String(row._id), baseUrl: row.baseUrl, headers });
    }
    return result;
  }

  async listSources(projectId: string) {
    const rows = await this.sources.find({ projectId }).lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      source: row.source,
      method: row.method,
      path: row.path,
      connectionId: row.connectionId ? String(row.connectionId) : null,
      runOnLoad: row.runOnLoad,
    }));
  }

  async saveSource(projectId: string, input: unknown, sourceId?: string) {
    const parsed = z.object({
      name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
      source: z.enum(["internal", "external"]).default("internal"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().min(1).max(200),
      connectionId: z.string().optional(),
      runOnLoad: z.boolean().default(true),
    }).parse(input);
    const payload = {
      ...parsed,
      connectionId: parsed.connectionId ? new Types.ObjectId(parsed.connectionId) : null,
    };
    const doc = sourceId
      ? await this.sources.findOneAndUpdate({ _id: sourceId, projectId }, { $set: payload }, { new: true })
      : await this.sources.create({ ...payload, projectId: new Types.ObjectId(projectId) });
    if (!doc) throw new AppError("NOT_FOUND", "Data source not found", 404);
    return { id: String(doc._id) };
  }

  async createApiKey(projectId: string, organizationId: string, userId: string, name: string) {
    const raw = `fk_live_${randomBytes(24).toString("base64url")}`;
    const doc = await this.keys.create({
      projectId: new Types.ObjectId(projectId),
      name: name.slice(0, 80),
      prefix: raw.slice(0, 12),
      hash: createHash("sha256").update(raw).digest("hex"),
      lastFour: raw.slice(-4),
      revokedAt: null,
    });
    await this.audit.record({ organizationId, projectId, userId, action: "apikey.created", resource: "apiKey", resourceId: String(doc._id) });
    return { id: String(doc._id), name: doc.name, key: raw, prefix: doc.prefix, lastFour: doc.lastFour };
  }

  async listApiKeys(projectId: string) {
    const rows = await this.keys.find({ projectId }).sort({ createdAt: -1 }).lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      prefix: row.prefix,
      lastFour: row.lastFour,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    }));
  }

  async revokeApiKey(projectId: string, organizationId: string, userId: string, keyId: string) {
    await this.keys.updateOne({ _id: keyId, projectId }, { $set: { revokedAt: new Date() } });
    await this.audit.record({ organizationId, projectId, userId, action: "apikey.revoked", resource: "apiKey", resourceId: keyId });
    return { revoked: true };
  }

  async publish(projectId: string, organizationId: string, userId: string) {
    const summary = await this.usage.summary(organizationId);
    const project = await this.projects.findById(projectId);
    if (!project) throw new AppError("NOT_FOUND", "Project not found", 404);
    if (!project.publishedVersion && summary.published >= summary.limits.publishedApps) {
      throw new AppError("PLAN_LIMIT", "This workspace has reached its published app limit", 402);
    }
    const [models, apis, workflows, pages, connections, org] = await Promise.all([
      this.models.find({ projectId }).lean(),
      this.apis.find({ projectId }).lean(),
      this.workflows.find({ projectId }).lean(),
      this.pages.find({ projectId }).lean(),
      this.connections.find({ projectId }).lean(),
      this.organizations.findById(organizationId).lean(),
    ]);
    const workflowById = new Map(workflows.map((workflow) => [String(workflow._id), workflow]));
    const version = project.publishedVersion + 1;
    const snapshot = {
      project: {
        id: projectId,
        name: project.name,
        slug: project.slug,
        authEnabled: project.authEnabled,
        organizationId,
        organizationSlug: org?.slug ?? "",
      },
      models: models.map((model) => ({
        id: String(model._id),
        name: model.name,
        slug: model.slug,
        fields: model.fields as FieldDef[],
      })),
      apis: apis.map((api) => {
        const workflow = workflowById.get(String(api.workflowId));
        return {
          id: String(api._id),
          name: api.name,
          method: api.method,
          path: api.path,
          auth: api.auth,
          roles: api.roles,
          workflowId: String(api.workflowId),
          workflow: workflow
            ? { name: workflow.name, nodes: workflow.nodes as WorkflowDef["nodes"], edges: workflow.edges as WorkflowDef["edges"] }
            : null,
        };
      }),
      pages: pages.map((page) => ({
        id: String(page._id),
        name: page.name,
        slug: page.slug,
        path: page.path,
        title: page.title,
        auth: page.auth,
        queries: page.queries,
        variables: page.variables ?? {},
        root: fillComponent(page.root),
      })),
      connections: connections.map((connection) => ({
        id: String(connection._id),
        name: connection.name,
        baseUrl: connection.baseUrl,
        authType: connection.authType,
        headerName: connection.headerName,
        secretId: connection.secretId ? String(connection.secretId) : null,
        headers: connection.headers,
      })),
    };
    const doc = await this.versions.create({
      projectId: new Types.ObjectId(projectId),
      version,
      snapshot,
      publishedBy: new Types.ObjectId(userId),
    });
    project.publishedVersion = version;
    project.publishedVersionId = doc._id;
    await project.save();
    await this.audit.record({ organizationId, projectId, userId, action: "app.published", resource: "deployment", resourceId: String(doc._id), metadata: { version } });
    return { version, id: String(doc._id) };
  }

  async listVersions(projectId: string) {
    const project = await this.projects.findById(projectId).lean();
    const rows = await this.versions.find({ projectId }).sort({ version: -1 }).limit(30).select("version createdAt publishedBy").lean();
    return {
      current: project?.publishedVersion ?? 0,
      versions: rows.map((row) => ({
        id: String(row._id),
        version: row.version,
        createdAt: row.createdAt,
        current: String(row._id) === String(project?.publishedVersionId),
      })),
    };
  }

  async rollback(projectId: string, organizationId: string, userId: string, versionId: string) {
    const version = await this.versions.findOne({ _id: versionId, projectId }).lean();
    if (!version) throw new AppError("NOT_FOUND", "Version not found", 404);
    await this.projects.updateOne({ _id: projectId }, { $set: { publishedVersion: version.version, publishedVersionId: version._id } });
    await this.audit.record({ organizationId, projectId, userId, action: "app.rollback", resource: "deployment", resourceId: versionId, metadata: { version: version.version } });
    return { version: version.version };
  }

  async currentSnapshot(projectId: string) {
    const project = await this.projects.findById(projectId).lean();
    if (!project?.publishedVersionId) return null;
    const version = await this.versions.findById(project.publishedVersionId).lean();
    return version?.snapshot ?? null;
  }

  templates() {
    return TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      models: template.models.map((model) => model.name),
    }));
  }

  async applyTemplate(userId: string, templateId: string, organizationId: string, name?: string) {
    const template = getTemplate(templateId);
    if (!template) throw new AppError("NOT_FOUND", "Template not found", 404);
    const access = await this.tenancy.createProject(userId, { organizationId, name: name || template.name, description: template.description });
    const projectId = access.project.id;
    await this.ensureEnvironments(projectId);
    for (const draft of template.models) {
      const model = await this.modelService.create(projectId, organizationId, userId, { name: draft.name, fields: draft.fields });
      await this.modelService.generate(projectId, organizationId, userId, model.id, template.upsertOnEmail ? "upsert" : "crud");
      await this.modelService.generatePage(projectId, model.id);
    }
    return access.project;
  }

  limits() {
    return PLANS;
  }
}
