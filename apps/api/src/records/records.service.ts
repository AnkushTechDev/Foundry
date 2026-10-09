import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  AppError,
  isSafeKey,
  validateRecordData,
  type FieldDef,
  type FilterClause,
} from "@foundry/shared";
import { Model, Types } from "mongoose";
import { RecordDoc } from "../database/schemas";

export interface ModelRef {
  id: string;
  fields: FieldDef[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
}

function toDto(doc: { _id: Types.ObjectId; data?: Record<string, unknown>; createdAt?: Date; updatedAt?: Date }) {
  return {
    ...(doc.data ?? {}),
    id: String(doc._id),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class RecordsService {
  constructor(@InjectModel(RecordDoc.name) private readonly records: Model<RecordDoc>) {}

  async list(
    projectId: string,
    model: ModelRef,
    input: { filters?: FilterClause[]; limit?: number; sort?: { field: string; direction: "asc" | "desc" }; projection?: string[] },
  ) {
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const query = this.compile(projectId, model, input.filters ?? []);
    const sortField = input.sort?.field && (input.sort.field === "createdAt" || model.fields.some((field) => field.key === input.sort?.field))
      ? input.sort.field === "createdAt" ? "createdAt" : `data.${input.sort.field}`
      : "createdAt";
    const rows = await this.records
      .find(query)
      .sort({ [sortField]: input.sort?.direction === "asc" ? 1 : -1, _id: -1 })
      .limit(limit)
      .lean();
    return rows.map((row) => {
      const dto = toDto(row);
      if (!input.projection?.length) return dto;
      const picked: Record<string, unknown> = { id: dto.id, createdAt: dto.createdAt, updatedAt: dto.updatedAt };
      for (const key of input.projection) if (isSafeKey(key)) picked[key] = (dto as Record<string, unknown>)[key];
      return picked;
    });
  }

  async findOne(projectId: string, model: ModelRef, input: { id?: string; filters?: FilterClause[] }) {
    if (input.id) {
      if (!Types.ObjectId.isValid(input.id)) return null;
      const row = await this.records.findOne({
        _id: input.id,
        projectId: new Types.ObjectId(projectId),
        modelId: new Types.ObjectId(model.id),
      }).lean();
      return row ? toDto(row) : null;
    }
    const row = await this.records.findOne(this.compile(projectId, model, input.filters ?? [])).lean();
    return row ? toDto(row) : null;
  }

  async create(projectId: string, model: ModelRef, input: unknown) {
    const data = validateRecordData(model.fields, input, false);
    await this.assertUnique(projectId, model, data);
    try {
      const row = await this.records.create({
        projectId: new Types.ObjectId(projectId),
        modelId: new Types.ObjectId(model.id),
        data,
      });
      return toDto(row.toObject());
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  async update(projectId: string, model: ModelRef, id: string, input: unknown) {
    if (!Types.ObjectId.isValid(id)) return null;
    const existing = await this.records.findOne({
      _id: id,
      projectId: new Types.ObjectId(projectId),
      modelId: new Types.ObjectId(model.id),
    });
    if (!existing) return null;
    const patch = validateRecordData(model.fields, input, true);
    await this.assertUnique(projectId, model, patch, id);
    existing.data = { ...existing.data, ...patch };
    existing.markModified("data");
    try {
      await existing.save();
    } catch (error) {
      this.rethrowDuplicate(error);
    }
    return toDto(existing.toObject());
  }

  async remove(projectId: string, model: ModelRef, id: string) {
    if (!Types.ObjectId.isValid(id)) return false;
    const result = await this.records.deleteOne({
      _id: id,
      projectId: new Types.ObjectId(projectId),
      modelId: new Types.ObjectId(model.id),
    });
    return result.deletedCount === 1;
  }

  async count(projectId: string, model: ModelRef, filters: FilterClause[]) {
    return this.records.countDocuments(this.compile(projectId, model, filters));
  }

  async countBy(projectId: string, model: ModelRef, field: string) {
    if (!model.fields.some((item) => item.key === field)) {
      throw new AppError("VALIDATION_FAILED", "Unknown field");
    }
    const rows = await this.records.aggregate<{ _id: unknown; count: number }>([
      { $match: { projectId: new Types.ObjectId(projectId), modelId: new Types.ObjectId(model.id) } },
      { $group: { _id: `$data.${field}`, count: { $sum: 1 } } },
      { $limit: 50 },
    ]);
    return rows.map((row) => ({ key: row._id == null ? "" : String(row._id), count: row.count }));
  }

  async syncIndexes(model: ModelRef): Promise<void> {
    const prefix = `dyn_${model.id}_`;
    const existing = await this.records.collection.indexes();
    const desired = new Set<string>();
    for (const field of model.fields) {
      if (!field.index && !field.unique) continue;
      const name = `${prefix}${field.key}`.slice(0, 120);
      desired.add(name);
      if (existing.some((index) => index.name === name)) continue;
      await this.records.collection.createIndex(
        { projectId: 1, modelId: 1, [`data.${field.key}`]: 1 },
        {
          name,
          unique: Boolean(field.unique),
          partialFilterExpression: {
            modelId: new Types.ObjectId(model.id),
            [`data.${field.key}`]: { $exists: true },
          },
        },
      );
    }
    for (const index of existing) {
      if (index.name?.startsWith(prefix) && !desired.has(index.name)) {
        await this.records.collection.dropIndex(index.name);
      }
    }
  }

  private compile(projectId: string, model: ModelRef, filters: FilterClause[]) {
    const clauses: Record<string, unknown>[] = [
      { projectId: new Types.ObjectId(projectId), modelId: new Types.ObjectId(model.id) },
    ];
    const known = new Map(model.fields.map((field) => [field.key, field]));
    for (const filter of filters) {
      if (filter.field === "id") {
        if (!Types.ObjectId.isValid(String(filter.value))) clauses.push({ _id: null });
        else clauses.push({ _id: new Types.ObjectId(String(filter.value)) });
        continue;
      }
      const field = known.get(filter.field);
      if (!field) continue;
      const path = `data.${field.key}`;
      const value = filter.value;
      if (filter.op === "eq") clauses.push({ [path]: value });
      else if (filter.op === "neq") clauses.push({ [path]: { $ne: value } });
      else if (filter.op === "gt") clauses.push({ [path]: { $gt: value } });
      else if (filter.op === "gte") clauses.push({ [path]: { $gte: value } });
      else if (filter.op === "lt") clauses.push({ [path]: { $lt: value } });
      else if (filter.op === "lte") clauses.push({ [path]: { $lte: value } });
      else if (filter.op === "contains") clauses.push({ [path]: { $regex: escapeRegex(String(value ?? "")), $options: "i" } });
      else if (filter.op === "in") clauses.push({ [path]: { $in: (Array.isArray(value) ? value : [value]).slice(0, 50) } });
    }
    return { $and: clauses };
  }

  private async assertUnique(projectId: string, model: ModelRef, data: Record<string, unknown>, ignoreId?: string) {
    for (const field of model.fields) {
      if (!field.unique || data[field.key] == null) continue;
      const clash = await this.records.findOne({
        projectId: new Types.ObjectId(projectId),
        modelId: new Types.ObjectId(model.id),
        [`data.${field.key}`]: data[field.key],
        ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
      }).select("_id").lean();
      if (clash) throw new AppError("CONFLICT", `${field.name} must be unique`, 409);
    }
  }

  private rethrowDuplicate(error: unknown): never {
    if (typeof error === "object" && error && "code" in error && (error as { code?: number }).code === 11000) {
      throw new AppError("CONFLICT", "A unique field already exists", 409);
    }
    throw error;
  }
}
