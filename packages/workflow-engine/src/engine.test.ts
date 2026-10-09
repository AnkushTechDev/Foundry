import { describe, expect, it } from "vitest";
import { buildCrudApis, buildUpsertByEmailApi } from "@foundry/shared";
import { executeWorkflow } from "./engine";
import type { DataPort, FilterClause } from "./types";

function memory(): DataPort & { rows: Map<string, Record<string, unknown>[]> } {
  const rows = new Map<string, Record<string, unknown>[]>();
  const list = (modelId: string) => rows.get(modelId) ?? [];
  const matches = (row: Record<string, unknown>, filters: FilterClause[]) =>
    filters.every((filter) => {
      const value = filter.field === "id" ? row.id : row[filter.field];
      if (filter.op === "eq") return value === filter.value;
      if (filter.op === "neq") return value !== filter.value;
      if (filter.op === "contains") return String(value ?? "").includes(String(filter.value ?? ""));
      return false;
    });

  return {
    rows,
    async findMany(input) {
      return list(input.modelId).filter((row) => matches(row, input.filters)).slice(0, input.limit);
    },
    async findOne(input) {
      if (input.id) return list(input.modelId).find((row) => row.id === input.id) ?? null;
      return list(input.modelId).find((row) => matches(row, input.filters)) ?? null;
    },
    async create(input) {
      const row = { id: crypto.randomUUID(), ...input.data };
      rows.set(input.modelId, [...list(input.modelId), row]);
      return row;
    },
    async update(input) {
      const next = list(input.modelId).map((row) => (row.id === input.id ? { ...row, ...input.data, id: row.id } : row));
      const updated = next.find((row) => row.id === input.id);
      if (!updated) return null;
      rows.set(input.modelId, next);
      return updated;
    },
    async delete(input) {
      const before = list(input.modelId);
      rows.set(input.modelId, before.filter((row) => row.id !== input.id));
      return rows.get(input.modelId)!.length !== before.length;
    },
    async count(input) {
      return list(input.modelId).filter((row) => matches(row, input.filters)).length;
    },
    async countBy(input) {
      const counts = new Map<string, number>();
      for (const row of list(input.modelId)) {
        const key = String(row[input.field] ?? "");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].map(([key, count]) => ({ key, count }));
    },
  };
}

describe("workflow engine", () => {
  it("creates a record through the generated CRUD workflow", async () => {
    const data = memory();
    const create = buildCrudApis("Customer", "customers").find((api) => api.method === "POST")!;
    const result = await executeWorkflow({
      workflow: create.workflow,
      projectId: "p1",
      data,
      trigger: { body: { name: "Ada", email: "ada@example.com" }, params: {}, query: {} },
    });
    expect(result.status).toBe("success");
    expect(result.response.statusCode).toBe(201);
    expect(result.response.body).toMatchObject({ name: "Ada", email: "ada@example.com" });
    expect(result.logs.every((log) => log.status === "success")).toBe(true);

    const list = buildCrudApis("Customer", "customers").find((api) => api.method === "GET" && api.path === "/customers")!;
    const listed = await executeWorkflow({
      workflow: list.workflow,
      projectId: "p1",
      data,
      trigger: { query: {}, params: {}, body: {} },
    });
    expect(listed.response.body).toMatchObject({ items: [expect.objectContaining({ email: "ada@example.com" })] });
  });

  it("returns 409 when the email already exists", async () => {
    const data = memory();
    await data.create({ projectId: "p1", modelId: "leads", data: { name: "Ada", email: "ada@example.com" } });
    const api = buildUpsertByEmailApi("Lead", "leads");
    const result = await executeWorkflow({
      workflow: api.workflow,
      projectId: "p1",
      data,
      trigger: { body: { name: "Ada", email: "ada@example.com" } },
    });
    expect(result.status).toBe("success");
    expect(result.response.statusCode).toBe(409);
    expect(data.rows.get("leads")).toHaveLength(1);
  });

  it("does not execute expression text as code", async () => {
    const data = memory();
    const result = await executeWorkflow({
      workflow: {
        name: "transform",
        nodes: [
          { id: "t", type: "manualTrigger", position: { x: 0, y: 0 }, data: { label: "Manual", config: {} } },
          {
            id: "x",
            type: "transform",
            position: { x: 200, y: 0 },
            data: { label: "Transform", config: { mapping: { value: "{{process.exit(1)}}" } } },
          },
          {
            id: "r",
            type: "returnResponse",
            position: { x: 400, y: 0 },
            data: { label: "Return", config: { statusCode: 200, body: "{{nodes.x.output}}" } },
          },
        ],
        edges: [
          { id: "e1", source: "t", target: "x", sourceHandle: "out" },
          { id: "e2", source: "x", target: "r", sourceHandle: "out" },
        ],
      },
      projectId: "p1",
      data,
    });
    expect(result.status).toBe("success");
    expect(result.response.body).toEqual({ value: null });
  });
});
