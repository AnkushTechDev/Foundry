"use client";

import { createId, FIELD_TYPES, fieldKey, type FieldDef } from "@foundry/shared";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

interface Model {
  id: string;
  name: string;
  slug: string;
  fields: FieldDef[];
}

const emptyField = (): FieldDef => ({ id: createId(), name: "", key: "", type: "string", required: false, unique: false, index: false });

export default function DatabasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [models, setModels] = useState<Model[]>([]);
  const [current, setCurrent] = useState<Model | null>(null);
  const [records, setRecords] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");

  async function load() {
    const next = await api<Model[]>(`/projects/${projectId}/models`);
    setModels(next);
    setCurrent((selected) => next.find((model) => model.id === selected?.id) ?? next[0] ?? null);
  }
  useEffect(() => { void load(); }, [projectId]);
  useEffect(() => {
    if (!current) return;
    api<{ items: Array<Record<string, unknown>> }>(`/projects/${projectId}/models/${current.id}/records`).then((result) => setRecords(result.items)).catch(() => setRecords([]));
  }, [current?.id, projectId]);

  async function createModel() {
    const model = await api<Model>(`/projects/${projectId}/models`, {
      method: "POST",
      body: JSON.stringify({ name: "Customer", fields: [
        { ...emptyField(), name: "Name", key: "name", required: true },
        { ...emptyField(), name: "Email", key: "email", required: true, unique: true },
        { ...emptyField(), name: "Phone", key: "phone" },
        { ...emptyField(), name: "Company", key: "company" },
        { ...emptyField(), name: "Status", key: "status", type: "enum", enumValues: ["new", "active"], required: true },
      ] }),
    });
    setMessage(`Created ${model.name}`);
    await load();
    setCurrent(model);
  }

  async function save() {
    if (!current) return;
    const fields = current.fields.map((field) => ({ ...field, key: field.key || fieldKey(field.name) })).filter((field) => field.name && field.key);
    const saved = await api<Model>(`/projects/${projectId}/models/${current.id}`, { method: "PATCH", body: JSON.stringify({ name: current.name, fields }) });
    setCurrent(saved);
    setMessage("Collection saved");
    await load();
  }

  async function generate() {
    if (!current) return;
    const result = await api<{ apis: unknown[]; page: { path: string } | null }>(`/projects/${projectId}/models/${current.id}/generate`, { method: "POST", body: JSON.stringify({ mode: "crud", page: true }) });
    setMessage(`Generated ${result.apis.length} routes${result.page ? ` and ${result.page.path}` : ""}`);
  }

  return (
    <div className="grid h-full grid-cols-[240px_1fr]">
      <aside className="border-r border-[hsl(var(--line))] p-3">
        <button className="mb-3 w-full rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white" onClick={() => void createModel()}>New collection</button>
        {models.map((model) => <button key={model.id} className={`mb-1 block w-full rounded-md px-2 py-1.5 text-left text-sm ${current?.id === model.id ? "bg-[hsl(var(--accent)/0.15)]" : ""}`} onClick={() => setCurrent(model)}>{model.name}</button>)}
      </aside>
      <section className="p-5">
        {!current ? <p className="text-sm text-[hsl(var(--mute))]">Create a collection. Customer is a useful starting point.</p> : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <input className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2 text-lg font-medium" value={current.name} onChange={(event) => setCurrent({ ...current, name: event.target.value })} />
              <button className="rounded-md border border-[hsl(var(--line))] px-3 py-2 text-sm" onClick={() => void save()}>Save</button>
              <button className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white" onClick={() => void generate()}>Generate CRUD API</button>
              {message ? <span className="text-sm text-[hsl(var(--mute))]">{message}</span> : null}
            </div>
            <div className="overflow-hidden rounded-xl border border-[hsl(var(--line))]">
              <table className="w-full text-sm">
                <thead className="bg-[hsl(var(--panel))] text-left text-[hsl(var(--mute))]"><tr><th className="px-3 py-2">Name</th><th>Key</th><th>Type</th><th>Required</th><th>Unique</th></tr></thead>
                <tbody>
                  {current.fields.map((field) => (
                    <tr key={field.id} className="border-t border-[hsl(var(--line))]">
                      <td className="px-3 py-2"><input className="bg-transparent" value={field.name} onChange={(event) => updateField(field.id, { name: event.target.value, key: fieldKey(event.target.value) })} /></td>
                      <td><input className="bg-transparent font-mono text-xs" value={field.key} onChange={(event) => updateField(field.id, { key: event.target.value })} /></td>
                      <td>
                        <select className="bg-transparent" value={field.type} onChange={(event) => updateField(field.id, { type: event.target.value as FieldDef["type"] })}>
                          {FIELD_TYPES.map((type) => <option key={type}>{type}</option>)}
                        </select>
                      </td>
                      <td><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /></td>
                      <td><input type="checkbox" checked={field.unique} onChange={(event) => updateField(field.id, { unique: event.target.checked, index: event.target.checked || field.index })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="mt-3 text-sm text-[hsl(var(--accent))]" onClick={() => setCurrent({ ...current, fields: [...current.fields, emptyField()] })}>Add field</button>
            {current.fields.some((field) => field.type === "enum") ? (
              <label className="mt-3 grid gap-1 text-sm">
                <span className="text-[hsl(var(--mute))]">Enum values (comma separated, first enum field)</span>
                <input className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={(current.fields.find((field) => field.type === "enum")?.enumValues ?? []).join(", ")} onChange={(event) => {
                  const values = event.target.value.split(",").map((item) => item.trim()).filter(Boolean);
                  const field = current.fields.find((item) => item.type === "enum");
                  if (field) updateField(field.id, { enumValues: values });
                }} />
              </label>
            ) : null}
            <h2 className="mb-2 mt-8 text-sm font-medium">Records</h2>
            <pre className="max-h-64 overflow-auto rounded-lg border border-[hsl(var(--line))] p-3 font-mono text-xs">{JSON.stringify(records, null, 2)}</pre>
          </>
        )}
      </section>
    </div>
  );

  function updateField(id: string, patch: Partial<FieldDef>) {
    if (!current) return;
    setCurrent({ ...current, fields: current.fields.map((field) => field.id === id ? { ...field, ...patch } : field) });
  }
}
