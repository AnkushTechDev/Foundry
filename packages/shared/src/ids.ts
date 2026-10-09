export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "item";
}

export function fieldKey(name: string): string {
  const parts = name
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!parts.length) return "field";
  const key =
    parts[0]!.toLowerCase() +
    parts
      .slice(1)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");
  if (key === "id" || key === "createdAt" || key === "updatedAt") {
    return `${key}Field`;
  }
  return key;
}

export function pluralize(name: string): string {
  const base = slugify(name);
  if (base.endsWith("s")) return base;
  if (base.endsWith("y") && !/[aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
}

export function nodeAlias(label: string): string {
  return fieldKey(label);
}

export function createId(): string {
  return crypto.randomUUID();
}

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export function isSafeKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}
