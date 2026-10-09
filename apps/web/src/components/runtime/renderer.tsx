"use client";

import { resolveTemplate, type ComponentNode, type QueryDef } from "@foundry/shared";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { runtimeRequest } from "../../lib/api";
import { ensureNode } from "../../lib/tree";

export interface RuntimeTarget {
  mode: "draft" | "published";
  projectId?: string;
  orgSlug?: string;
  projectSlug?: string;
}

interface QueryState {
  data: unknown;
  loading: boolean;
  error: string;
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: Record<string, unknown>[] }).items;
  }
  return [];
}

function endpoint(target: RuntimeTarget, path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (target.mode === "draft") return `/runtime/projects/${target.projectId}/draft${normalized}`;
  return `/runtime/apps/${target.orgSlug}/${target.projectSlug}${normalized}`;
}

export function AppRenderer({
  page,
  pages,
  target,
  onNavigate,
}: {
  page: { name: string; path: string; queries?: QueryDef[]; root: ComponentNode; variables?: Record<string, unknown> };
  pages: Array<{ path: string; name: string }>;
  target: RuntimeTarget;
  onNavigate: (path: string) => void;
}) {
  const [queries, setQueries] = useState<Record<string, QueryState>>({});
  const [forms, setForms] = useState<Record<string, Record<string, unknown>>>({});
  const [modals, setModals] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState("");
  const [variables, setVariables] = useState<Record<string, unknown>>(page.variables ?? {});

  const scope = useMemo(
    () => ({
      queries: Object.fromEntries(Object.entries(queries).map(([name, state]) => [name, { data: state.data, loading: state.loading, error: state.error }])),
      form: forms,
      variables,
      currentUser: null,
    }),
    [queries, forms, variables],
  );

  async function runQuery(query: QueryDef) {
    setQueries((current) => ({ ...current, [query.name]: { data: current[query.name]?.data ?? null, loading: true, error: "" } }));
    try {
      const result = await runtimeRequest(endpoint(target, query.path), {
        method: query.method,
        body: query.method === "GET" ? undefined : JSON.stringify(resolveTemplate(query.body ?? {}, scope)),
      });
      setQueries((current) => ({
        ...current,
        [query.name]: { data: result.body, loading: false, error: result.status >= 400 ? "Request failed" : "" },
      }));
    } catch (error) {
      setQueries((current) => ({ ...current, [query.name]: { data: null, loading: false, error: error instanceof Error ? error.message : "Request failed" } }));
    }
  }

  useEffect(() => {
    for (const query of page.queries ?? []) {
      if (query.runOnLoad) void runQuery(query);
    }
    // Reload when the page or runtime target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.path, target.projectId, target.projectSlug]);

  async function runActions(actions: ComponentNode["actions"], event: string, formName?: string) {
    for (const action of actions ?? []) {
      if (action.event !== event) continue;
      const config = action.config ?? {};
      if (action.type === "toast") setToast(String(resolveTemplate(config.message ?? config.text ?? "Done", scope) ?? ""));
      if (action.type === "navigate") onNavigate(String(config.path ?? "/"));
      if (action.type === "openModal") setModals((current) => ({ ...current, [String(config.modalId)]: true }));
      if (action.type === "closeModal") setModals((current) => ({ ...current, [String(config.modalId)]: false }));
      if (action.type === "setVariable") setVariables((current) => ({ ...current, [String(config.name)]: resolveTemplate(config.value, scope) }));
      if (action.type === "refreshQuery") {
        const query = (page.queries ?? []).find((item) => item.name === config.query || item.name === config.refreshQuery);
        if (query) await runQuery(query);
      }
      if (action.type === "api.call") {
        const result = await runtimeRequest(endpoint(target, String(config.path ?? "/")), {
          method: String(config.method ?? "POST"),
          body: ["GET", "HEAD"].includes(String(config.method ?? "POST")) ? undefined : JSON.stringify(resolveTemplate(config.body ?? {}, scope) ?? {}),
        });
        if (result.status >= 400) {
          const message = result.body && typeof result.body === "object" && "message" in result.body ? String(result.body.message) : "Request failed";
          setToast(message);
          continue;
        }
        if (config.toast) setToast(String(config.toast));
        if (config.resetForm && formName) setForms((current) => ({ ...current, [formName]: {} }));
        if (config.refreshQuery) {
          const query = (page.queries ?? []).find((item) => item.name === config.refreshQuery);
          if (query) await runQuery(query);
        }
        if (config.navigate) onNavigate(String(config.navigate));
      }
    }
  }

  function setField(formName: string, name: string, value: unknown) {
    setForms((current) => ({ ...current, [formName]: { ...(current[formName] ?? {}), [name]: value } }));
  }

  return (
    <div className="min-h-full bg-[hsl(var(--canvas))] text-[hsl(var(--ink))]">
      <RenderNode
        node={page.root}
        formName=""
        scope={scope}
        queries={queries}
        forms={forms}
        modals={modals}
        pages={pages}
        onNavigate={onNavigate}
        runActions={runActions}
        setField={setField}
      />
      {toast ? (
        <button className="fixed bottom-4 right-4 z-50 rounded-md bg-[hsl(var(--ink))] px-3 py-2 text-sm text-[hsl(var(--canvas))] shadow-lift" onClick={() => setToast("")}>
          {toast}
        </button>
      ) : null}
    </div>
  );
}

function RenderNode(props: {
  node: ComponentNode;
  formName: string;
  scope: Record<string, unknown>;
  queries: Record<string, QueryState>;
  forms: Record<string, Record<string, unknown>>;
  modals: Record<string, boolean>;
  pages: Array<{ path: string; name: string }>;
  onNavigate: (path: string) => void;
  runActions: (actions: ComponentNode["actions"], event: string, formName?: string) => Promise<void>;
  setField: (formName: string, name: string, value: unknown) => void;
}) {
  const node = ensureNode(props.node);
  if (node.visibleIf && !resolveTemplate(node.visibleIf.startsWith("{{") ? node.visibleIf : `{{${node.visibleIf}}}`, props.scope)) return null;
  const text = (key: string, fallback = "") => String(resolveTemplate(node.props[key] ?? fallback, props.scope) ?? "");
  const style = nodeStyle(node);
  const children = node.children.map((child) => <RenderNode key={child.id} {...props} node={child} formName={node.type === "Form" ? String(node.props.name ?? "form") : props.formName} />);
  const formName = node.type === "Form" ? String(node.props.name ?? "form") : props.formName;

  if (node.type === "Modal" && !props.modals[String(node.props.modalId ?? node.id)] && node.props.open !== true) return null;
  if (node.type === "Heading") {
    const level = Number(node.props.level ?? 2);
    const Tag = (level === 1 ? "h1" : level === 3 ? "h3" : "h2") as "h1";
    return <Tag style={style} className={level === 1 ? "text-3xl font-semibold tracking-tight" : "text-xl font-semibold"}>{text("text", "Heading")}</Tag>;
  }
  if (node.type === "Text" || node.type === "Label") return <p style={style} className="text-sm text-[hsl(var(--mute))]">{text("text")}</p>;
  if (node.type === "Button") {
    return (
      <button
        type={node.props.buttonType === "submit" ? "submit" : "button"}
        style={style}
        className={`rounded-md px-3 py-2 text-sm font-medium ${node.props.variant === "ghost" ? "border border-[hsl(var(--line))]" : "bg-[hsl(var(--accent))] text-white"}`}
        onClick={(event) => {
          if (node.props.buttonType === "submit") return;
          event.preventDefault();
          void props.runActions(node.actions, "click", formName);
        }}
      >
        {text("text", "Button")}
      </button>
    );
  }
  if (node.type === "Input" || node.type === "DatePicker") {
    return (
      <label style={style} className="grid gap-1 text-sm">
        <span>{text("label", "Field")}</span>
        <input
          className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2"
          name={String(node.props.name ?? "")}
          type={node.type === "DatePicker" ? "date" : String(node.props.inputType ?? "text")}
          placeholder={text("placeholder")}
          value={String(props.forms[formName]?.[String(node.props.name ?? "")] ?? "")}
          onChange={(event) => props.setField(formName, String(node.props.name ?? ""), event.target.value)}
        />
      </label>
    );
  }
  if (node.type === "Textarea") {
    return (
      <label style={style} className="grid gap-1 text-sm">
        <span>{text("label")}</span>
        <textarea className="min-h-24 rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" value={String(props.forms[formName]?.[String(node.props.name ?? "")] ?? "")} onChange={(event) => props.setField(formName, String(node.props.name ?? ""), event.target.value)} />
      </label>
    );
  }
  if (node.type === "Select" || node.type === "Radio") {
    const options = Array.isArray(node.props.options) ? node.props.options.map(String) : [];
    return (
      <label style={style} className="grid gap-1 text-sm">
        <span>{text("label")}</span>
        {node.type === "Select" ? (
          <select className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" value={String(props.forms[formName]?.[String(node.props.name ?? "")] ?? "")} onChange={(event) => props.setField(formName, String(node.props.name ?? ""), event.target.value)}>
            <option value="">Select</option>
            {options.map((option) => <option key={option}>{option}</option>)}
          </select>
        ) : (
          <div className="flex gap-3">{options.map((option) => <label key={option} className="flex items-center gap-1"><input type="radio" checked={props.forms[formName]?.[String(node.props.name ?? "")] === option} onChange={() => props.setField(formName, String(node.props.name ?? ""), option)} />{option}</label>)}</div>
        )}
      </label>
    );
  }
  if (node.type === "Checkbox" || node.type === "Switch") {
    const name = String(node.props.name ?? "");
    return <label style={style} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(props.forms[formName]?.[name])} onChange={(event) => props.setField(formName, name, event.target.checked)} />{text("label")}</label>;
  }
  if (node.type === "Form") {
    return (
      <form
        style={style}
        className="grid"
        onSubmit={(event) => {
          event.preventDefault();
          void props.runActions(node.actions, "submit", formName);
        }}
      >
        {children}
      </form>
    );
  }
  if (node.type === "Table") {
    const queryName = String(node.props.query ?? "");
    const state = props.queries[queryName];
    const records = rowsOf(state?.data);
    const columns = Array.isArray(node.props.columns) ? node.props.columns as Array<{ key: string; header: string }> : [];
    return (
      <div style={style} className="overflow-hidden rounded-lg border border-[hsl(var(--line))]">
        {state?.loading ? <div className="p-4 text-sm text-[hsl(var(--mute))]">Loading records…</div> : null}
        {state?.error ? <div className="p-4 text-sm text-red-500">{state.error}</div> : null}
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[hsl(var(--panel))] text-left text-[hsl(var(--mute))]">
            <tr>{columns.map((column) => <th key={column.key} className="px-3 py-2 font-medium">{column.header}</th>)}</tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={String(record.id)} className="border-t border-[hsl(var(--line))]">
                {columns.map((column) => <td key={column.key} className="px-3 py-2">{String(record[column.key] ?? "")}</td>)}
              </tr>
            ))}
            {!records.length && !state?.loading ? <tr><td className="px-3 py-6 text-[hsl(var(--mute))]" colSpan={Math.max(columns.length, 1)}>No records yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    );
  }
  if (node.type === "List") {
    const records = rowsOf(props.queries[String(node.props.query ?? "")]?.data);
    return <div style={style} className="grid gap-2">{records.map((record) => <div key={String(record.id)} className="rounded-md border border-[hsl(var(--line))] p-3 text-sm">{String(record.name ?? record.title ?? record.email ?? record.id)}</div>)}</div>;
  }
  if (node.type === "Link") return <button style={style} className="text-sm text-[hsl(var(--accent))]" onClick={() => props.onNavigate(text("href", "/"))}>{text("text", "Link")}</button>;
  if (node.type === "Badge") return <span style={style} className="inline-flex rounded-full bg-[hsl(var(--accent)/0.15)] px-2 py-0.5 text-xs">{text("text")}</span>;
  if (node.type === "Alert") return <div style={style} className="rounded-md border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-3 py-2 text-sm">{text("text")}</div>;
  if (node.type === "Divider") return <hr style={style} className="border-[hsl(var(--line))]" />;
  if (node.type === "Image") return <img style={style} alt={text("alt")} src={text("src")} className="max-w-full rounded-md" />;
  if (node.type === "Loader") return <div style={style} className="h-5 w-5 animate-spin rounded-full border-2 border-[hsl(var(--line))] border-t-[hsl(var(--accent))]" />;
  if (node.type === "Navbar") return <header style={style} className="flex items-center justify-between border-b border-[hsl(var(--line))] px-4 py-3"><strong>{text("title", "App")}</strong><nav className="flex gap-3 text-sm">{props.pages.map((item) => <button key={item.path} onClick={() => props.onNavigate(item.path)}>{item.name}</button>)}</nav></header>;
  const layout = node.type === "Row" || node.type === "Grid" ? "flex flex-wrap items-start" : "grid";
  return <div style={style} className={layout}>{node.type === "Card" && node.props.title ? <strong>{text("title")}</strong> : null}{children}</div>;
}

function nodeStyle(node: ComponentNode): CSSProperties {
  const style = node.style ?? {};
  return {
    padding: style.padding,
    margin: style.margin,
    gap: style.gap,
    width: style.width,
    height: style.height,
    background: style.background,
    color: style.color,
    borderRadius: style.borderRadius,
    border: style.border,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    alignItems: style.align,
    justifyContent: style.justify === "between" ? "space-between" : style.justify,
  };
}
