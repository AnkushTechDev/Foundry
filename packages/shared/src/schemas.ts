import { z } from "zod";
import {
  API_AUTH_MODES,
  COMPONENT_TYPES,
  FIELD_TYPES,
  HTTP_METHODS,
  NODE_TYPES,
} from "./constants";

export const fieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  index: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().max(120).optional(),
  enumValues: z.array(z.string().min(1).max(80)).max(50).optional(),
  refModelId: z.string().optional(),
  itemType: z.enum(["string", "number", "boolean", "object"]).optional(),
});

export const styleSchema = z
  .object({
    padding: z.number().min(0).max(200).optional(),
    margin: z.number().min(0).max(200).optional(),
    gap: z.number().min(0).max(80).optional(),
    width: z.string().max(20).optional(),
    height: z.string().max(20).optional(),
    background: z.string().max(32).optional(),
    color: z.string().max(32).optional(),
    borderRadius: z.number().min(0).max(80).optional(),
    border: z.string().max(40).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    justify: z.enum(["start", "center", "end", "between"]).optional(),
    fontSize: z.number().min(10).max(72).optional(),
    fontWeight: z.number().min(400).max(800).optional(),
  })
  .strict();

export const actionSchema = z.object({
  id: z.string().min(1),
  event: z.enum(["click", "submit", "success"]),
  type: z.enum([
    "api.call",
    "navigate",
    "openModal",
    "closeModal",
    "setVariable",
    "refreshQuery",
    "toast",
  ]),
  config: z.record(z.unknown()),
});

export type ComponentNode = {
  id: string;
  type: (typeof COMPONENT_TYPES)[number];
  props: Record<string, unknown>;
  style?: z.infer<typeof styleSchema>;
  children: ComponentNode[];
  actions?: z.infer<typeof actionSchema>[];
  visibleIf?: string;
};

export const componentNodeSchema: z.ZodType<ComponentNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum(COMPONENT_TYPES),
    props: z.record(z.unknown()),
    style: styleSchema.optional(),
    children: z.array(componentNodeSchema).max(50),
    actions: z.array(actionSchema).max(12).optional(),
    visibleIf: z.string().max(500).optional(),
  }),
);

export const querySchema = z.object({
  id: z.string().min(1),
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
  source: z.enum(["internal", "external"]).default("internal"),
  method: z.enum(HTTP_METHODS),
  path: z.string().min(1).max(200),
  connectionId: z.string().optional(),
  runOnLoad: z.boolean().default(true),
  headers: z.record(z.string()).optional(),
  query: z.record(z.string()).optional(),
  body: z.unknown().optional(),
});

export const pageSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80),
  path: z.string().min(1).max(120),
  title: z.string().max(120).optional(),
  auth: z.enum(["public", "authenticated"]).default("public"),
  queries: z.array(querySchema).max(30).default([]),
  variables: z.record(z.unknown()).default({}),
  root: componentNodeSchema,
});

export const workflowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(NODE_TYPES),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  data: z.object({
    label: z.string().min(1).max(80),
    config: z.record(z.unknown()).default({}),
  }),
});

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().max(40).optional(),
});

export const workflowSchema = z.object({
  name: z.string().min(1).max(80),
  nodes: z.array(workflowNodeSchema).max(80),
  edges: z.array(workflowEdgeSchema).max(120),
});

export const modelInputSchema = z.object({
  name: z.string().min(1).max(80),
  fields: z.array(fieldSchema).min(1).max(60),
});

export const apiAuthSchema = z.enum(API_AUTH_MODES);

export const filterSchema = z.object({
  field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.unknown(),
});

export const blueprintSchema = z.object({
  projectName: z.string().min(1).max(80),
  description: z.string().max(400).default(""),
  models: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        fields: z.array(
          fieldSchema.omit({ id: true }).extend({ id: z.string().min(1).optional() }),
        ).min(1).max(40),
      }),
    )
    .min(1)
    .max(8),
  includeCrud: z.boolean().default(true),
});

export type FieldDef = z.infer<typeof fieldSchema>;
export type QueryDef = z.infer<typeof querySchema>;
export type PageDef = z.infer<typeof pageSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type WorkflowDef = z.infer<typeof workflowSchema>;
export type FilterClause = z.infer<typeof filterSchema>;
export type Blueprint = z.infer<typeof blueprintSchema>;
