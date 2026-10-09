"use client";

import { DndContext, type DragEndEvent, useDraggable, useDroppable } from "@dnd-kit/core";
import { createId, type ComponentNode, type PageDef, type QueryDef } from "@foundry/shared";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { canHaveChildren, createComponent, duplicateNode, ensureNode, findNode, insertNode, moveNode, PALETTE, removeNode, updateNode } from "../../lib/tree";
import { cn } from "../../lib/utils";

type PageRecord = PageDef & { id: string };

export function PageBuilder({ projectId, pageId }: { projectId: string; pageId: string }) {
  const [page, setPage] = useState<PageRecord | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [past, setPast] = useState<PageRecord[]>([]);
  const [future, setFuture] = useState<PageRecord[]>([]);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [clipboard, setClipboard] = useState<ComponentNode | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PageRecord>(`/projects/${projectId}/pages/${pageId}`)
      .then((record) => setPage({ ...record, root: ensureNode(record.root) }))
      .catch((reason: Error) => setError(reason.message));
  }, [projectId, pageId]);

  function commit(next: PageRecord) {
    if (!page) return;
    setPast((current) => [...current, page].slice(-50));
    setFuture([]);
    setPage(next);
    setSaveState("unsaved");
  }

  useEffect(() => {
    if (!page || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      api(`/projects/${projectId}/pages/${pageId}`, { method: "PATCH", body: JSON.stringify(page) })
        .then(() => setSaveState("saved"))
        .catch((reason: Error) => {
          setSaveState("unsaved");
          setError(reason.message);
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [page, saveState, projectId, pageId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select")) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          setFuture((current) => {
            const next = current[current.length - 1];
            if (!next || !page) return current;
            setPast((history) => [...history, page]);
            setPage(next);
            setSaveState("unsaved");
            return current.slice(0, -1);
          });
        } else {
          setPast((current) => {
            const previous = current[current.length - 1];
            if (!previous || !page) return current;
            setFuture((stack) => [...stack, page]);
            setPage(previous);
            setSaveState("unsaved");
            return current.slice(0, -1);
          });
        }
      }
      if (!page || !selected) return;
      if (event.key === "Backspace" || event.key === "Delete") {
        commit(mutate(page, (root) => removeNode(root, selected)));
        setSelected(page.root.id);
      }
      if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        commit(mutate(page, (root) => duplicateNode(root, selected)));
      }
      if (meta && event.key.toLowerCase() === "c") {
        const node = findNode(page.root, selected);
        if (node) setClipboard(structuredClone(node));
      }
      if (meta && event.key.toLowerCase() === "v" && clipboard) {
        const copy = { ...structuredClone(clipboard), id: createId() };
        const parent = findNode(page.root, selected);
        const parentId = parent && canHaveChildren(parent.type) ? parent.id : page.root.id;
        commit(mutate(page, (root) => insertNode(root, parentId, copy)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onDragEnd(event: DragEndEvent) {
    if (!page) return;
    const type = String(event.active.data.current?.type ?? "");
    if (!type) return;
    const parentId = String(event.over?.id ?? selected ?? page.root.id);
    const parent = findNode(page.root, parentId);
    const destination = parent && canHaveChildren(parent.type) ? parent.id : page.root.id;
    const node = createComponent(type as ComponentNode["type"]);
    commit(mutate(page, (root) => insertNode(root, destination, node)));
    setSelected(node.id);
  }

  const selectedNode = page && selected ? findNode(page.root, selected) : page?.root ?? null;
  const width = device === "mobile" ? 390 : device === "tablet" ? 768 : 1100;

  if (!page) return <div className="p-8 text-sm text-[hsl(var(--mute))]">{error || "Loading builder…"}</div>;

  return (
    <DndContext onDragEnd={onDragEnd}>
      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[240px_1fr_300px] grid-rows-[auto_1fr_180px]">
        <header className="col-span-3 flex items-center gap-2 border-b border-[hsl(var(--line))] px-3 py-2">
          <strong className="mr-2 text-sm">{page.name}</strong>
          {(["desktop", "tablet", "mobile"] as const).map((item) => (
            <button key={item} className={cn("rounded-md px-2 py-1 text-xs capitalize", device === item && "bg-[hsl(var(--accent)/0.15)]")} onClick={() => setDevice(item)}>{item}</button>
          ))}
          <span className="ml-auto text-xs text-[hsl(var(--mute))]">{saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : "Saved"}</span>
          <a className="rounded-md border border-[hsl(var(--line))] px-2 py-1 text-xs" href={`/embed/${projectId}${page.path}`} target="_blank">Preview</a>
        </header>
        <aside className="overflow-auto border-r border-[hsl(var(--line))] p-3">
          {PALETTE.map((group) => (
            <div key={group.category} className="mb-4">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-[hsl(var(--mute))]">{group.category}</div>
              <div className="grid grid-cols-2 gap-1">
                {group.types.map((type) => <PaletteItem key={type} type={type} onAdd={() => {
                  const node = createComponent(type);
                  const parent = selected ? findNode(page.root, selected) : null;
                  const parentId = parent && canHaveChildren(parent.type) ? parent.id : page.root.id;
                  commit(mutate(page, (root) => insertNode(root, parentId, node)));
                  setSelected(node.id);
                }} />)}
              </div>
            </div>
          ))}
        </aside>
        <main className="canvas-dot overflow-auto p-6" onClick={() => setSelected(page.root.id)}>
          <div className="mx-auto min-h-[640px] rounded-xl border border-[hsl(var(--line))] bg-[hsl(var(--panel))] shadow-lift" style={{ width }}>
            <CanvasNode node={page.root} selected={selected} onSelect={setSelected} />
          </div>
        </main>
        <aside className="overflow-auto border-l border-[hsl(var(--line))] p-3">
          {selectedNode ? (
            <Properties
              node={selectedNode}
              onChange={(next) => commit(mutate(page, (root) => updateNode(root, next.id, () => next)))}
              onDuplicate={() => commit(mutate(page, (root) => duplicateNode(root, selectedNode.id)))}
              onDelete={() => selectedNode.id !== page.root.id && commit(mutate(page, (root) => removeNode(root, selectedNode.id)))}
              onMove={(direction) => commit(mutate(page, (root) => moveNode(root, selectedNode.id, direction)))}
            />
          ) : null}
        </aside>
        <QueryBar page={page} onChange={(queries) => commit({ ...page, queries })} />
      </div>
    </DndContext>
  );
}

function mutate(page: PageRecord, updater: (root: ComponentNode) => ComponentNode): PageRecord {
  return { ...page, root: updater(page.root) };
}

function PaletteItem({ type, onAdd }: { type: string; onAdd: () => void }) {
  const drag = useDraggable({ id: `palette-${type}`, data: { type } });
  return (
    <button ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} className="rounded-md border border-[hsl(var(--line))] px-2 py-1 text-left text-xs" onClick={onAdd}>
      {type}
    </button>
  );
}

function CanvasNode({ node: raw, selected, onSelect }: { node: ComponentNode; selected: string | null; onSelect: (id: string) => void }) {
  const node = ensureNode(raw);
  const drop = useDroppable({ id: node.id, disabled: !canHaveChildren(node.type) });
  return (
    <div
      ref={drop.setNodeRef}
      className={cn("m-2 rounded-md border border-transparent p-2", selected === node.id && "border-[hsl(var(--accent))]", drop.isOver && "bg-[hsl(var(--accent)/0.08)]")}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}
    >
      <div className="mb-1 text-[10px] uppercase tracking-wide text-[hsl(var(--mute))]">{node.type}</div>
      {node.props.text || node.props.label || node.props.title ? <div className="text-sm">{String(node.props.text ?? node.props.label ?? node.props.title)}</div> : null}
      {node.children.map((child) => <CanvasNode key={child.id} node={child} selected={selected} onSelect={onSelect} />)}
    </div>
  );
}

function Properties({ node, onChange, onDuplicate, onDelete, onMove }: { node: ComponentNode; onChange: (node: ComponentNode) => void; onDuplicate: () => void; onDelete: () => void; onMove: (direction: -1 | 1) => void }) {
  const fields = useMemo(() => Object.keys(node.props), [node]);
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-center justify-between">
        <strong>{node.type}</strong>
        <div className="flex gap-1">
          <button className="rounded border border-[hsl(var(--line))] px-1" onClick={() => onMove(-1)}>↑</button>
          <button className="rounded border border-[hsl(var(--line))] px-1" onClick={() => onMove(1)}>↓</button>
          <button className="rounded border border-[hsl(var(--line))] px-1" onClick={onDuplicate}>Copy</button>
          <button className="rounded border border-[hsl(var(--line))] px-1" onClick={onDelete}>Del</button>
        </div>
      </div>
      {fields.map((key) => (
        <label key={key} className="grid gap-1">
          <span className="text-xs text-[hsl(var(--mute))]">{key}</span>
          <input
            className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1"
            value={typeof node.props[key] === "string" || typeof node.props[key] === "number" ? String(node.props[key]) : JSON.stringify(node.props[key])}
            onChange={(event) => {
              const raw = event.target.value;
              let value: unknown = raw;
              if (raw.startsWith("[") || raw.startsWith("{")) {
                try { value = JSON.parse(raw); } catch { value = raw; }
              }
              onChange({ ...node, props: { ...node.props, [key]: value } });
            }}
          />
        </label>
      ))}
      <label className="grid gap-1">
        <span className="text-xs text-[hsl(var(--mute))]">Visible if</span>
        <input className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={node.visibleIf ?? ""} onChange={(event) => onChange({ ...node, visibleIf: event.target.value || undefined })} placeholder='{{currentUser.role == "admin"}}' />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[hsl(var(--mute))]">Padding</span>
        <input type="number" className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={node.style?.padding ?? 0} onChange={(event) => onChange({ ...node, style: { ...node.style, padding: Number(event.target.value) } })} />
      </label>
      {(node.type === "Button" || node.type === "Form") ? <ActionEditor node={node} onChange={onChange} /> : null}
    </div>
  );
}

function ActionEditor({ node, onChange }: { node: ComponentNode; onChange: (node: ComponentNode) => void }) {
  const action = node.actions?.[0];
  const config = (action?.config ?? {}) as Record<string, unknown>;
  function setConfig(patch: Record<string, unknown>) {
    onChange({
      ...node,
      actions: [{
        id: action?.id ?? createId(),
        event: node.type === "Form" ? "submit" : "click",
        type: "api.call",
        config: { ...config, ...patch },
      }],
    });
  }
  return (
    <div className="grid gap-2 rounded-md border border-[hsl(var(--line))] p-2">
      <div className="text-xs uppercase tracking-wide text-[hsl(var(--mute))]">On {node.type === "Form" ? "submit" : "click"}</div>
      <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" placeholder="POST" value={String(config.method ?? "")} onChange={(event) => setConfig({ method: event.target.value.toUpperCase() })} />
      <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" placeholder="/customers" value={String(config.path ?? "")} onChange={(event) => setConfig({ path: event.target.value })} />
      <textarea className="min-h-20 rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1 font-mono text-xs" placeholder='{"name":"{{form.create.name}}"}' value={typeof config.body === "string" ? config.body : JSON.stringify(config.body ?? {}, null, 2)} onChange={(event) => {
        try { setConfig({ body: JSON.parse(event.target.value) }); } catch { setConfig({ body: event.target.value }); }
      }} />
      <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" placeholder="Toast message" value={String(config.toast ?? "")} onChange={(event) => setConfig({ toast: event.target.value })} />
      <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" placeholder="Refresh query" value={String(config.refreshQuery ?? "")} onChange={(event) => setConfig({ refreshQuery: event.target.value })} />
    </div>
  );
}

function QueryBar({ page, onChange }: { page: PageRecord; onChange: (queries: QueryDef[]) => void }) {
  const [draft, setDraft] = useState({ name: "", method: "GET", path: "" });
  return (
    <section className="col-span-3 border-t border-[hsl(var(--line))] p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-[hsl(var(--mute))]">Queries</div>
      <div className="flex flex-wrap items-center gap-2">
        {page.queries.map((query) => (
          <button key={query.id} className="rounded-full border border-[hsl(var(--line))] px-2 py-1 text-xs" onClick={() => onChange(page.queries.filter((item) => item.id !== query.id))}>
            {query.method} {query.name} {query.path} ×
          </button>
        ))}
        <input className="w-28 rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1 text-xs" placeholder="name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        <input className="w-16 rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1 text-xs" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value.toUpperCase() })} />
        <input className="w-40 rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1 text-xs" placeholder="/customers" value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} />
        <button className="rounded bg-[hsl(var(--accent))] px-2 py-1 text-xs text-white" onClick={() => {
          if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(draft.name) || !draft.path) return;
          onChange([...page.queries, { id: createId(), name: draft.name, source: "internal", method: draft.method as QueryDef["method"], path: draft.path, runOnLoad: true }]);
          setDraft({ name: "", method: "GET", path: "" });
        }}>Add query</button>
      </div>
    </section>
  );
}
