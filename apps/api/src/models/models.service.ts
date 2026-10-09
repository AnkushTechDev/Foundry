import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  AppError,
  assertFields,
  buildCrudApis,
  buildCrudPage,
  buildUpsertByEmailApi,
  fieldKey,
  fieldSchema,
  slugify,
  type FieldDef,
} from "@foundry/shared";
import { Model, Types } from "mongoose";
import { z } from "zod";
import { ApiDefinition, DataModel, Page, Workflow } from "../database/schemas";
import { AuditService } from "../platform/platform.module";
import { RecordsService } from "../records/records.service";

const writeSchema = z.object({
  name: z.string().min(1).max(80),
  fields: z.array(fieldSchema).min(1).max(60),
});

function modelDto(doc: { _id: Types.ObjectId; name: string; slug: string; fields: unknown[]; createdAt?: Date; updatedAt?: Date }) {
  return {
    id: String(doc._id),
    name: doc.name,
    slug: doc.slug,
    fields: doc.fields as FieldDef[],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class ModelsService {
  constructor(
    @InjectModel(DataModel.name) private readonly models: Model<DataModel>,
    @InjectModel(Workflow.name) private readonly workflows: Model<Workflow>,
    @InjectModel(ApiDefinition.name) private readonly apis: Model<ApiDefinition>,
    @InjectModel(Page.name) private readonly pages: Model<Page>,
    private readonly records: RecordsService,
    private readonly audit: AuditService,
  ) {}

  async list(projectId: string) {
    const rows = await this.models.find({ projectId: new Types.ObjectId(projectId) }).sort({ createdAt: 1 }).lean();
    return rows.map((row) => modelDto(row));
  }

  async get(projectId: string, modelId: string) {
    const row = await this.models.findOne({ _id: modelId, projectId }).lean();
    if (!row) throw new AppError("NOT_FOUND", "Collection not found", 404);
    return modelDto(row);
  }

  async create(projectId: string, organizationId: string, userId: string, input: unknown) {
    const parsed = writeSchema.parse(input);
    parsed.fields = parsed.fields.map((field) => ({ ...field, key: field.key || fieldKey(field.name) }));
    assertFields(parsed.fields);
    const slug = await this.uniqueSlug(projectId, slugify(parsed.name));
    const doc = await this.models.create({
      projectId: new Types.ObjectId(projectId),
      organizationId: new Types.ObjectId(organizationId),
      name: parsed.name.trim(),
      slug,
      fields: parsed.fields,
    });
    await this.records.syncIndexes({ id: String(doc._id), fields: parsed.fields });
    await this.audit.record({
      organizationId,
      projectId,
      userId,
      action: "model.created",
      resource: "model",
      resourceId: String(doc._id),
      metadata: { name: doc.name },
    });
    return modelDto(doc);
  }

  async update(projectId: string, organizationId: string, userId: string, modelId: string, input: unknown) {
    const parsed = writeSchema.parse(input);
    assertFields(parsed.fields);
    const doc = await this.models.findOneAndUpdate(
      { _id: modelId, projectId },
      { $set: { name: parsed.name.trim(), fields: parsed.fields } },
      { new: true },
    ).lean();
    if (!doc) throw new AppError("NOT_FOUND", "Collection not found", 404);
    await this.records.syncIndexes({ id: String(doc._id), fields: parsed.fields });
    await this.audit.record({ organizationId, projectId, userId, action: "model.updated", resource: "model", resourceId: modelId });
    return modelDto(doc);
  }

  async remove(projectId: string, organizationId: string, userId: string, modelId: string) {
    const doc = await this.models.findOneAndDelete({ _id: modelId, projectId });
    if (!doc) throw new AppError("NOT_FOUND", "Collection not found", 404);
    await this.audit.record({ organizationId, projectId, userId, action: "model.deleted", resource: "model", resourceId: modelId });
    return { deleted: true };
  }

  async generate(projectId: string, organizationId: string, userId: string, modelId: string, mode: "crud" | "upsert" = "crud") {
    const model = await this.get(projectId, modelId);
    const drafts = buildCrudApis(model.name, model.id);
    if (mode === "upsert") {
      const upsert = buildUpsertByEmailApi(model.name, model.id);
      const index = drafts.findIndex((draft) => draft.method === "POST");
      if (index >= 0) drafts[index] = upsert;
    }
    const apis = [];
    for (const draft of drafts) {
      const workflow = await this.workflows.create({
        projectId: new Types.ObjectId(projectId),
        name: draft.workflow.name,
        nodes: draft.workflow.nodes,
        edges: draft.workflow.edges,
      });
      const api = await this.apis.findOneAndUpdate(
        { projectId: new Types.ObjectId(projectId), method: draft.method, path: draft.path },
        {
          $set: {
            name: draft.name,
            auth: draft.auth,
            workflowId: workflow._id,
            modelId: new Types.ObjectId(model.id),
            roles: [],
          },
          $setOnInsert: {
            projectId: new Types.ObjectId(projectId),
            method: draft.method,
            path: draft.path,
          },
        },
        { upsert: true, new: true },
      );
      apis.push({
        id: String(api!._id),
        name: api!.name,
        method: api!.method,
        path: api!.path,
        workflowId: String(api!.workflowId),
      });
    }
    await this.audit.record({
      organizationId,
      projectId,
      userId,
      action: "api.generated",
      resource: "model",
      resourceId: modelId,
    });
    return { apis };
  }

  async generatePage(projectId: string, modelId: string) {
    const model = await this.get(projectId, modelId);
    const page = buildCrudPage(model.name, model.fields);
    const existing = await this.pages.findOne({ projectId, path: page.path }).lean();
    if (existing) return { id: String(existing._id), path: existing.path, created: false };
    const doc = await this.pages.create({ ...page, projectId: new Types.ObjectId(projectId) });
    return { id: String(doc._id), path: doc.path, created: true };
  }

  private async uniqueSlug(projectId: string, base: string) {
    let slug = base;
    for (let i = 0; i < 30; i += 1) {
      const exists = await this.models.exists({ projectId, slug });
      if (!exists) return slug;
      slug = `${base}-${i + 2}`;
    }
    return `${base}-${crypto.randomUUID().slice(0, 6)}`;
  }
}
