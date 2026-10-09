"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

export default function IntegrationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<Array<{ id: string; name: string; baseUrl: string; authType: string }>>([]);
  const [form, setForm] = useState({ name: "", baseUrl: "https://api.example.com", authType: "bearer", secret: "" });
  const [sources, setSources] = useState<Array<{ id: string; name: string; method: string; path: string }>>([]);

  async function load() {
    const [connections, dataSources] = await Promise.all([
      api<typeof rows>(`/projects/${projectId}/connections`),
      api<typeof sources>(`/projects/${projectId}/data-sources`),
    ]);
    setRows(connections);
    setSources(dataSources);
  }
  useEffect(() => { void load(); }, [projectId]);

  return (
    <div className="grid gap-8 p-6 lg:grid-cols-2">
      <section>
        <h1 className="mb-3 text-xl font-semibold">Connections</h1>
        <form className="grid gap-2" onSubmit={async (event) => {
          event.preventDefault();
          await api(`/projects/${projectId}/connections`, { method: "POST", body: JSON.stringify(form) });
          setForm({ ...form, secret: "" });
          await load();
        }}>
          <input required className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input required className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" placeholder="Base URL" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
          <select className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" value={form.authType} onChange={(event) => setForm({ ...form, authType: event.target.value })}>
            {["none", "bearer", "apiKey", "basic"].map((type) => <option key={type}>{type}</option>)}
          </select>
          <input className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" placeholder="Secret (stored encrypted, never shown again)" value={form.secret} onChange={(event) => setForm({ ...form, secret: event.target.value })} />
          <button className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white">Save connection</button>
        </form>
        <ul className="mt-4 grid gap-2 text-sm">{rows.map((row) => <li key={row.id} className="rounded-lg border border-[hsl(var(--line))] px-3 py-2">{row.name} · {row.authType}<div className="text-[hsl(var(--mute))]">{row.baseUrl}</div></li>)}</ul>
      </section>
      <section>
        <h2 className="mb-3 text-xl font-semibold">Data sources</h2>
        <form className="mb-3 flex gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          await api(`/projects/${projectId}/data-sources`, { method: "POST", body: JSON.stringify({ name: formData.get("name"), method: formData.get("method"), path: formData.get("path"), source: "internal" }) });
          event.currentTarget.reset();
          await load();
        }}>
          <input name="name" required placeholder="customers" className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" />
          <input name="method" defaultValue="GET" className="w-20 rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" />
          <input name="path" required placeholder="/customers" className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" />
          <button className="rounded-md border border-[hsl(var(--line))] px-2 text-sm">Add</button>
        </form>
        <ul className="grid gap-2 text-sm">{sources.map((source) => <li key={source.id} className="rounded-lg border border-[hsl(var(--line))] px-3 py-2 font-mono text-xs">{source.method} {source.name} {source.path}</li>)}</ul>
      </section>
    </div>
  );
}
