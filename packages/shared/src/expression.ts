import { LIMITS } from "./constants";

export type ExpressionValue =
  | string
  | number
  | boolean
  | null
  | ExpressionValue[]
  | { [key: string]: ExpressionValue };

export type Scope = Record<string, unknown>;

type Ast =
  | { type: "literal"; value: ExpressionValue }
  | { type: "path"; parts: Array<string | number> }
  | { type: "unary"; op: "!"; expr: Ast }
  | { type: "binary"; op: string; left: Ast; right: Ast };

const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);
const cache = new Map<string, Ast>();

function remember(source: string, ast: Ast): Ast {
  if (cache.has(source)) cache.delete(source);
  cache.set(source, ast);
  if (cache.size > LIMITS.maxExpressionCache) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return ast;
}

class ParseError extends Error {}

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): Ast {
    const expr = this.parseOr();
    this.skip();
    if (this.index < this.source.length) {
      throw new ParseError("Unexpected token");
    }
    return expr;
  }

  private parseOr(): Ast {
    let left = this.parseAnd();
    while (this.match("||")) {
      left = { type: "binary", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Ast {
    let left = this.parseEquality();
    while (this.match("&&")) {
      left = { type: "binary", op: "&&", left, right: this.parseEquality() };
    }
    return left;
  }

  private parseEquality(): Ast {
    let left = this.parseRel();
    for (;;) {
      const op = this.matchOne("===", "!==", "==", "!=");
      if (!op) break;
      left = { type: "binary", op, left, right: this.parseRel() };
    }
    return left;
  }

  private parseRel(): Ast {
    let left = this.parseUnary();
    for (;;) {
      const op = this.matchOne(">=", "<=", ">", "<");
      if (!op) break;
      left = { type: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): Ast {
    this.skip();
    if (this.match("!")) return { type: "unary", op: "!", expr: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): Ast {
    this.skip();
    if (this.match("(")) {
      const expr = this.parseOr();
      if (!this.match(")")) throw new ParseError("Expected )");
      return expr;
    }
    const literal = this.parseLiteral();
    if (literal) return literal;
    return this.parsePath();
  }

  private parseLiteral(): Ast | null {
    this.skip();
    if (this.matchKeyword("true")) return { type: "literal", value: true };
    if (this.matchKeyword("false")) return { type: "literal", value: false };
    if (this.matchKeyword("null")) return { type: "literal", value: null };
    const char = this.source[this.index];
    if (char === '"' || char === "'") return { type: "literal", value: this.parseString() };
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
      const match = /^-?\d+(?:\.\d+)?/.exec(this.source.slice(this.index));
      if (!match) return null;
      this.index += match[0].length;
      return { type: "literal", value: Number(match[0]) };
    }
    return null;
  }

  private parseString(): string {
    const quote = this.source[this.index];
    this.index += 1;
    let value = "";
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === quote) {
        this.index += 1;
        return value;
      }
      if (char === "\\") {
        const next = this.source[this.index + 1];
        if (next === "n") value += "\n";
        else if (next === "t") value += "\t";
        else if (next) value += next;
        this.index += 2;
        continue;
      }
      value += char ?? "";
      this.index += 1;
    }
    throw new ParseError("Unterminated string");
  }

  private parsePath(): Ast {
    this.skip();
    const ident = this.parseIdent();
    if (!ident) throw new ParseError("Expected expression");
    const parts: Array<string | number> = [ident];
    for (;;) {
      if (this.match(".")) {
        const next = this.parseIdent();
        if (!next) throw new ParseError("Expected property");
        parts.push(next);
        continue;
      }
      if (this.match("[")) {
        this.skip();
        const quote = this.source[this.index];
        if (quote === '"' || quote === "'") {
          parts.push(this.parseString());
        } else {
          const match = /^\d+/.exec(this.source.slice(this.index));
          if (!match) throw new ParseError("Expected index");
          this.index += match[0].length;
          parts.push(Number(match[0]));
        }
        this.skip();
        if (!this.match("]")) throw new ParseError("Expected ]");
        continue;
      }
      break;
    }
    return { type: "path", parts };
  }

  private parseIdent(): string | null {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.index));
    if (!match) return null;
    this.index += match[0].length;
    return match[0];
  }

  private matchKeyword(token: string): boolean {
    this.skip();
    if (!this.source.startsWith(token, this.index)) return false;
    const next = this.source[this.index + token.length];
    if (next && /[A-Za-z0-9_]/.test(next)) return false;
    this.index += token.length;
    return true;
  }

  private match(token: string): boolean {
    this.skip();
    if (this.source.startsWith(token, this.index)) {
      const next = this.source[this.index + token.length];
      if ((token === "!" || token === "=" || token === "<" || token === ">") && next === "=") {
        return false;
      }
      this.index += token.length;
      return true;
    }
    return false;
  }

  private matchOne(...tokens: string[]): string | null {
    for (const token of tokens) {
      if (this.match(token)) return token;
    }
    return null;
  }

  private skip(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
  }
}

function parseExpression(source: string): Ast {
  const cached = cache.get(source);
  if (cached) {
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  return remember(source, new Parser(source).parse());
}

function readPath(scope: Scope, parts: Array<string | number>): unknown {
  let current: unknown = scope;
  for (const part of parts) {
    if (typeof part === "string" && BLOCKED.has(part)) return null;
    if (current == null || typeof current !== "object") return null;
    if (Array.isArray(current)) {
      if (typeof part !== "number") return null;
      current = current[part] ?? null;
      continue;
    }
    if (typeof part !== "string") return null;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function compare(op: string, left: unknown, right: unknown): boolean {
  if (op === "==" || op === "===") return Object.is(left, right);
  if (op === "!=" || op === "!==") return !Object.is(left, right);
  if (typeof left !== "number" || typeof right !== "number" || Number.isNaN(left) || Number.isNaN(right)) {
    return false;
  }
  if (op === ">") return left > right;
  if (op === ">=") return left >= right;
  if (op === "<") return left < right;
  if (op === "<=") return left <= right;
  return false;
}

function evaluate(ast: Ast, scope: Scope): unknown {
  switch (ast.type) {
    case "literal":
      return ast.value;
    case "path":
      return readPath(scope, ast.parts);
    case "unary":
      return !isTruthy(evaluate(ast.expr, scope));
    case "binary": {
      if (ast.op === "&&") {
        const left = evaluate(ast.left, scope);
        return isTruthy(left) ? evaluate(ast.right, scope) : false;
      }
      if (ast.op === "||") {
        const left = evaluate(ast.left, scope);
        return isTruthy(left) ? left : evaluate(ast.right, scope);
      }
      return compare(ast.op, evaluate(ast.left, scope), evaluate(ast.right, scope));
    }
    default:
      return null;
  }
}

function evaluateSource(source: string, scope: Scope): unknown {
  try {
    return evaluate(parseExpression(source.trim()), scope);
  } catch {
    return null;
  }
}

const FULL = /^\{\{([\s\S]+)\}\}$/;
const PART = /\{\{([\s\S]+?)\}\}/g;

export function resolveExpression(source: string, scope: Scope): unknown {
  return evaluateSource(source, scope);
}

export function resolveTemplate(input: unknown, scope: Scope): unknown {
  if (typeof input === "string") {
    const full = FULL.exec(input.trim());
    if (full?.[1] && input.trim().startsWith("{{") && input.trim().endsWith("}}") && !input.trim().slice(2, -2).includes("{{")) {
      return evaluateSource(full[1], scope);
    }
    if (!input.includes("{{")) return input;
    return input.replace(PART, (_match, source: string) => {
      const value = evaluateSource(source, scope);
      if (value == null) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return JSON.stringify(value);
    });
  }
  if (Array.isArray(input)) return input.map((item) => resolveTemplate(item, scope));
  if (input && typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (key.startsWith("$") || BLOCKED.has(key)) continue;
      output[key] = resolveTemplate(value, scope);
    }
    return output;
  }
  return input;
}
