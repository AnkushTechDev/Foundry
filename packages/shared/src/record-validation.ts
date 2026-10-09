import { AppError } from "./errors";
import type { FieldDef } from "./schemas";

const RESERVED = new Set(["id", "_id", "createdAt", "updatedAt"]);

function fail(message: string, details?: unknown): never {
  throw new AppError("VALIDATION_FAILED", message, 400, details);
}

function compilePattern(pattern: string): RegExp | null {
  if (pattern.length > 120) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

export function assertFields(fields: FieldDef[]): void {
  const keys = new Set<string>();
  for (const field of fields) {
    if (RESERVED.has(field.key)) fail(`"${field.key}" is reserved`);
    if (keys.has(field.key)) fail(`Duplicate field "${field.key}"`);
    keys.add(field.key);
    if (field.type === "enum" && (!field.enumValues || field.enumValues.length === 0)) {
      fail(`Enum field "${field.key}" needs values`);
    }
    if (field.pattern && !compilePattern(field.pattern)) {
      fail(`Invalid pattern on "${field.key}"`);
    }
  }
}

function coerce(field: FieldDef, value: unknown): unknown {
  if (value == null || value === "") {
    return value === "" && field.type === "string" ? "" : null;
  }
  switch (field.type) {
    case "string":
    case "reference": {
      if (typeof value !== "string" && typeof value !== "number") fail(`${field.name} must be text`);
      const text = String(value).trim();
      if (field.min != null && text.length < field.min) fail(`${field.name} is too short`);
      if (field.max != null && text.length > field.max) fail(`${field.name} is too long`);
      if (field.pattern) {
        const regex = compilePattern(field.pattern);
        if (regex && text.length <= 500 && !regex.test(text)) fail(`${field.name} is invalid`);
      }
      return text;
    }
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) fail(`${field.name} must be a number`);
      if (field.min != null && num < field.min) fail(`${field.name} is below the minimum`);
      if (field.max != null && num > field.max) fail(`${field.name} is above the maximum`);
      return num;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      fail(`${field.name} must be true or false`);
    }
    case "date": {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) fail(`${field.name} must be a date`);
      return date.toISOString();
    }
    case "enum": {
      const text = String(value);
      if (!field.enumValues?.includes(text)) fail(`${field.name} must be one of the allowed values`);
      return text;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) fail(`${field.name} must be an object`);
      return value;
    }
    case "array": {
      if (!Array.isArray(value)) fail(`${field.name} must be a list`);
      if (value.length > 200) fail(`${field.name} has too many items`);
      return value;
    }
    default:
      return null;
  }
}

export function validateRecordData(
  fields: FieldDef[],
  input: unknown,
  partial: boolean,
): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("Record body must be an object");
  }
  const source = input as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const present = Object.prototype.hasOwnProperty.call(source, field.key);
    if (!present || source[field.key] == null || source[field.key] === "") {
      if (!partial && field.required && field.defaultValue == null) {
        fail(`${field.name} is required`);
      }
      if (!partial && field.defaultValue != null && !present) {
        data[field.key] = coerce(field, field.defaultValue);
      }
      continue;
    }
    const value = coerce(field, source[field.key]);
    if (value != null) data[field.key] = value;
  }
  return data;
}
