import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { AppError, pageSchema, workflowSchema, type WorkflowDef } from "@foundry/shared";
import { Model, Types } from "mongoose";
import { Page, Workflow } from "../database/schemas";
import { AuditService, QueueService } from "../platform/platform.module";

export function fillComponent(value: unknown): Record<string, unknown> {
  const node = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const children = Array.isArray(node.children) ? node.children.map((child) => fillComponent(child)) : [];
  return { ...node, props: node.props && typeof node.props === "object" ? node.props : {}, children };
}

function cronFrom(nodes: WorkflowDef["nodes"]): string | null {
  const trigger = nodes.find((node) => node.type === "scheduleTrigger");
  if (!trigger) return null;
  const config = trigger.data.config ?? {};
  const every = String(config.every ?? "");
  if (every === "hour") return "0 * * * *";
  if (every === "day") return "0 9 * * *";
  if (every === "week") return "0 9 * * 1";
  if (typeof config.cron !== "string" || !config.cron.trim()) return null;
  const parts = config.cron.trim().split(/\s+/);
  if (parts.length !== 5 || parts.some((part) => !/^[\d*,\-/]+$/.test(part))) {
    throw new AppError("INVALID_CRON", "Cron must have 5 fields using digits and , - * /");
  }
  return config.cron.trim();
}

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectModel(Workflow.name) private readonly workflows: Model<Workflow>,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  async list(projectId: string) {
    const rows = await this.workflows.find({ projectId: new Types.ObjectId(projectId) }).sort({ updatedAt: -1 }).lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      nodeCount: Array.isArray(row.nodes) ? row.nodes.length : 0,
      updatedAt: row.updatedAt,
    }));
  }

  async get(projectId: string, workflowId: string): Promise<WorkflowDef & { id: string }> {
    const row = await this.workflows.findOne({ _id: workflowId, projectId }).lean();
    if (!row) throw new AppError("NOT_FOUND", "Workflow not found", 404);
    return { id: String(row._id), name: row.name, nodes: row.nodes as WorkflowDef["nodes"], edges: row.edges as WorkflowDef["edges"] };
  }

  async save(projectId: string, organizationId: string, userId: string, workflowId: string | null, input: unknown) {
    const parsed = workflowSchema.parse(input);
    const cron = cronFrom(parsed.nodes);
    const doc = workflowId
      ? await this.workflows.findOneAndUpdate(
          { _id: workflowId, projectId },
          { $set: { name: parsed.name, nodes: parsed.nodes, edges: parsed.edges } },
          { new: true },
        )
      : await this.workflows.create({
          projectId: new Types.ObjectId(projectId),
          name: parsed.name,
          nodes: parsed.nodes,
          edges: parsed.edges,
        });
    if (!doc) throw new AppError("NOT_FOUND", "Workflow not found", 404);
    const id = String(doc._id);
    if (cron) await this.queue.schedule(id, projectId, cron);
    else await this.queue.unschedule(id);
    await this.audit.record({
      organizationId,
      projectId,
      userId,
      action: workflowId ? "workflow.updated" : "workflow.created",
      resource: "workflow",
      resourceId: id,
    });
    return { id, name: doc.name, nodes: parsed.nodes, edges: parsed.edges };
  }

  async remove(projectId: string, organizationId: string, userId: string, workflowId: string) {
    const doc = await this.workflows.findOneAndDelete({ _id: workflowId, projectId });
    if (!doc) throw new AppError("NOT_FOUND", "Workflow not found", 404);
    await this.queue.unschedule(workflowId);
    await this.audit.record({ organizationId, projectId, userId, action: "workflow.deleted", resource: "workflow", resourceId: workflowId });
    return { deleted: true };
  }
}

@Injectable()
export class PagesService {
  constructor(
    @InjectModel(Page.name) private readonly pages: Model<Page>,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string) {
    const rows = await this.pages.find({ projectId: new Types.ObjectId(projectId) }).sort({ updatedAt: -1 }).lean();
    return rows.map((row) => ({
      id: String(row._id),
      name: row.name,
      slug: row.slug,
      path: row.path,
      auth: row.auth,
      updatedAt: row.updatedAt,
    }));
  }

  async get(projectId: string, pageId: string) {
    const row = await this.pages.findOne({ _id: pageId, projectId }).lean();
    if (!row) throw new AppError("NOT_FOUND", "Page not found", 404);
    return {
      id: String(row._id),
      name: row.name,
      slug: row.slug,
      path: row.path,
      title: row.title,
      auth: row.auth,
      queries: row.queries,
      variables: row.variables ?? {},
      root: fillComponent(row.root),
      updatedAt: row.updatedAt,
    };
  }

  async save(projectId: string, organizationId: string, userId: string, pageId: string | null, input: unknown) {
    const parsed = pageSchema.parse(input);
    const doc = pageId
      ? await this.pages.findOneAndUpdate({ _id: pageId, projectId }, { $set: parsed }, { new: true })
      : await this.pages.create({ ...parsed, projectId: new Types.ObjectId(projectId) });
    if (!doc) throw new AppError("NOT_FOUND", "Page not found", 404);
    await this.audit.record({
      organizationId,
      projectId,
      userId,
      action: pageId ? "page.updated" : "page.created",
      resource: "page",
      resourceId: String(doc._id),
    });
    return this.get(projectId, String(doc._id));
  }

  async remove(projectId: string, organizationId: string, userId: string, pageId: string) {
    const doc = await this.pages.findOneAndDelete({ _id: pageId, projectId });
    if (!doc) throw new AppError("NOT_FOUND", "Page not found", 404);
    await this.audit.record({ organizationId, projectId, userId, action: "page.deleted", resource: "page", resourceId: pageId });
    return { deleted: true };
  }
}
