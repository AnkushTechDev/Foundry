"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

interface ApiRow { id: string; name: string; method: string; path: string; auth: string; workflowId: string }

export default function ApisPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<ApiRow[]>([]);
  const [selected, setSelected] = useState<ApiRow | null>(null);
  const [body, setBody] = useState('{\n  "name": "Ada",\n  "email": "ada@example.com"\n}');
  const [id, setId] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => { api<ApiRow[]>(`/projects/${projectId}/apis`).then(setRows).catch(() => undefined); }, [projectId]);

  async function send() {
    if (!selected) return;
    let parsed: unknown = {};
    if (!["GET", "DELETE"].includes(selected.method)) {
      try { parsed = JSON.parse(body); } catch { setResult("Body must be JSON"); return; }
    }
    const response = await api<{ statusCode: number; durationMs: number; body: unknown; logs: Array<{ label: string; status: string; durationMs: number }> }>(`/projects/${projectId}/apis/${selected.id}/test`, {
      method: "POST",
      body: JSON.stringify({ body: parsed, params: id ? { id } : {} }),
    });
    setResult(`${response.statusCode} · ${response.durationMs} ms\n${JSON.stringify(response.body, null, 2)}\n\n${response.logs.map((log) => `${log.status} ${log.label} ${log.durationMs}ms`).join("\n")}`);
  }

  return (
    <div className="grid h-full grid-cols-[320px_1fr]">
      <aside className="border-r border-[hsl(var(--line))] p-3">
        {rows.map((row) => (
          <button key={row.id} className={`mb-1 block w-full rounded-md px-2 py-2 text-left text-sm ${selected?.id === row.id ? "bg-[hsl(var(--accent)/0.15)]" : ""}`} onClick={() => setSelected(row)}>
            <span className="font-mono text-xs">{row.method}</span> {row.path}
          </button>
        ))}
        {!rows.length ? <p className="text-sm text-[hsl(var(--mute))]">Generate a CRUD API from a collection.</p> : null}
      </aside>
      <section className="p-5">
        {selected ? (
          <>
            <div className="mb-3 flex items-center gap-3">
              <h1 className="font-mono text-lg">{selected.method} {selected.path}</h1>
              <select className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1 text-sm" value={selected.auth} onChange={async (event) => {
                const auth = event.target.value;
                await api(`/projects/${projectId}/apis/${selected.id}`, { method: "PATCH", body: JSON.stringify({ auth }) });
                setSelected({ ...selected, auth });
              }}>
                {["public", "authenticated", "role", "apiKey"].map((mode) => <option key={mode}>{mode}</option>)}
              </select>
              <a className="text-sm text-[hsl(var(--accent))]" href={`/projects/${projectId}/workflows/${selected.workflowId}`}>Open workflow</a>
            </div>
            {selected.path.includes(":id") ? <input className="mb-2 w-full rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2 font-mono text-sm" placeholder="id" value={id} onChange={(event) => setId(event.target.value)} /> : null}
            {!["GET", "DELETE"].includes(selected.method) ? <textarea className="h-40 w-full rounded-md border border-[hsl(var(--line))] bg-transparent p-3 font-mono text-xs" value={body} onChange={(event) => setBody(event.target.value)} /> : null}
            <button className="mt-3 rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white" onClick={() => void send()}>Send</button>
            <pre className="mt-4 overflow-auto rounded-lg border border-[hsl(var(--line))] p-3 font-mono text-xs">{result}</pre>
          </>
        ) : <p className="text-sm text-[hsl(var(--mute))]">Select an endpoint to test it.</p>}
      </section>
    </div>
  );
}
