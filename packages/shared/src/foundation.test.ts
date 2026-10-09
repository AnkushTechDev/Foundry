import { describe, expect, it } from "vitest";
import { resolveExpression, resolveTemplate } from "./expression";
import { validateRecordData } from "./record-validation";
import { fieldKey, pluralize } from "./ids";
import { buildCrudApis, buildCrudPage } from "./blueprints";
import { pageSchema, workflowSchema } from "./schemas";
import type { FieldDef } from "./schemas";

const scope = {
  trigger: { body: { email: "a@b.co", name: "Ada" }, params: { id: "1" } },
  nodes: { findCustomer: { output: { name: "Ada", id: "c1" } } },
  variables: { companyId: "acme" },
  currentUser: { name: "Ada", role: "admin" },
  queries: { customers: { data: [{ name: "Ada" }] } },
  form: { create: { email: "a@b.co" } },
};

describe("expression resolver", () => {
  it("reads paths without eval", () => {
    expect(resolveTemplate("{{trigger.body.email}}", scope)).toBe("a@b.co");
    expect(resolveTemplate("{{nodes.findCustomer.output.name}}", scope)).toBe("Ada");
    expect(resolveTemplate("{{variables.companyId}}", scope)).toBe("acme");
    expect(resolveTemplate("Welcome {{currentUser.name}}", scope)).toBe("Welcome Ada");
  });

  it("evaluates comparisons and rejects prototype access", () => {
    expect(resolveTemplate('{{currentUser.role == "admin"}}', scope)).toBe(true);
    expect(resolveTemplate("{{currentUser.role == 'member'}}", scope)).toBe(false);
    expect(resolveTemplate("{{queries.customers.data[0].name}}", scope)).toBe("Ada");
    expect(resolveTemplate('{{nodes["findCustomer"].output.name}}', scope)).toBe("Ada");
    expect(resolveTemplate("{{constructor.constructor}}", scope)).toBeNull();
    expect(resolveTemplate("{{trigger.body.__proto__}}", scope)).toBeNull();
  });

  it("preserves object values for a single binding", () => {
    expect(resolveTemplate("{{nodes.findCustomer.output}}", scope)).toEqual({ name: "Ada", id: "c1" });
  });
});

describe("record validation", () => {
  const fields: FieldDef[] = [
    { id: "1", name: "Email", key: "email", type: "string", required: true, unique: true, index: true },
    { id: "2", name: "Salary", key: "salary", type: "number", required: false, unique: false, index: false, min: 0 },
    { id: "3", name: "Status", key: "status", type: "enum", required: true, unique: false, index: false, enumValues: ["open", "closed"] },
  ];

  it("coerces and drops unknown fields", () => {
    expect(validateRecordData(fields, { email: "a@b.co", salary: "10", status: "open", $where: "1" }, false)).toEqual({
      email: "a@b.co",
      salary: 10,
      status: "open",
    });
  });

  it("rejects invalid enums", () => {
    expect(() => validateRecordData(fields, { email: "a@b.co", status: "nope" }, false)).toThrow(/allowed values/);
  });
});

describe("blueprints", () => {
  it("builds a validated CRUD workflow and page", () => {
    const apis = buildCrudApis("Customer", "model-1");
    expect(apis.map((api) => `${api.method} ${api.path}`)).toEqual([
      "GET /customers",
      "GET /customers/:id",
      "POST /customers",
      "PATCH /customers/:id",
      "DELETE /customers/:id",
    ]);
    for (const api of apis) expect(workflowSchema.safeParse(api.workflow).success).toBe(true);
    const page = buildCrudPage("Customer", [
      { id: "1", name: "Name", key: "name", type: "string", required: true, unique: false, index: false },
      { id: "2", name: "Email", key: "email", type: "string", required: true, unique: true, index: true },
    ]);
    expect(pageSchema.safeParse(page).success).toBe(true);
    expect(page.queries[0]?.path).toBe("/customers");
  });

  it("pluralizes names", () => {
    expect(pluralize("Company")).toBe("companies");
    expect(fieldKey("Expected Close")).toBe("expectedClose");
  });
});
