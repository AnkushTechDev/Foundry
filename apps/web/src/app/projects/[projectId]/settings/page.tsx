"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

export default function SettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [authEnabled, setAuthEnabled] = useState(false);
  const [secrets, setSecrets] = useState<Array<{ id: string; key: string; environment: string }>>([]);
  const [keys, setKeys] = useState<Array<{ id: string; name: string; prefix: string; lastFour: string; revokedAt: string | null }>>([]);
  const [freshKey, setFreshKey] = useState("");
  const [audit, setAudit] = useState<Array<{ id: string; action: string; createdAt: string }>>([]);

  async function load() {
    const [project, secretRows, keyRows, auditRows] = await Promise.all([
      api<{ project: { authEnabled: boolean } }>(`/projects/${projectId}`),
      api<typeof secrets>(`/projects/${projectId}/secrets`),
      api<typeof keys>(`/projects/${projectId}/api-keys`),
      api<typeof audit>(`/projects/${projectId}/audit`),
    ]);
    setAuthEnabled(project.project.authEnabled);
    setSecrets(secretRows);
    setKeys(keyRows);
    setAudit(auditRows);
  }
  useEffect(() => { void load(); }, [projectId]);

  return (
    <div className="grid gap-8 p-6 lg:grid-cols-2">
      <section>
        <h1 className="mb-3 text-xl font-semibold">Project</h1>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={authEnabled} onChange={async (event) => {
            setAuthEnabled(event.target.checked);
            await api(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ authEnabled: event.target.checked }) });
          }} />
          Enable email and password for the published app
        </label>
        <h2 className="mb-2 mt-6 font-medium">Secrets</h2>
        <form className="mb-3 flex gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await api(`/projects/${projectId}/secrets`, { method: "POST", body: JSON.stringify({ key: form.get("key"), value: form.get("value"), environment: "development" }) });
          event.currentTarget.reset();
          await load();
        }}>
          <input name="key" required placeholder="STRIPE_KEY" className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" />
          <input name="value" required placeholder="value" className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" />
          <button className="rounded-md border border-[hsl(var(--line))] px-2 text-sm">Save</button>
        </form>
        <ul className="text-sm">{secrets.map((secret) => <li key={secret.id} className="flex justify-between py-1"><span className="font-mono text-xs">{secret.environment}:{secret.key}</span><button onClick={async () => { await api(`/projects/${projectId}/secrets/${secret.id}`, { method: "DELETE" }); await load(); }}>Delete</button></li>)}</ul>
      </section>
      <section>
        <h2 className="mb-2 font-medium">API keys</h2>
        <form className="mb-3 flex gap-2" onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const created = await api<{ key: string }>(`/projects/${projectId}/api-keys`, { method: "POST", body: JSON.stringify({ name: form.get("name") }) });
          setFreshKey(created.key);
          event.currentTarget.reset();
          await load();
        }}>
          <input name="name" required placeholder="Key name" className="rounded-md border border-[hsl(var(--line))] bg-transparent px-2 py-1" />
          <button className="rounded-md bg-[hsl(var(--accent))] px-3 text-sm text-white">Create</button>
        </form>
        {freshKey ? <p className="mb-3 break-all rounded-md border border-[hsl(var(--line))] p-2 font-mono text-xs">Copy this key now. It will not be shown again.<br />{freshKey}</p> : null}
        <ul className="mb-6 text-sm">{keys.map((key) => <li key={key.id} className="flex justify-between py-1"><span>{key.name} · {key.prefix}…{key.lastFour}</span>{!key.revokedAt ? <button onClick={async () => { await api(`/projects/${projectId}/api-keys/${key.id}/revoke`, { method: "POST" }); await load(); }}>Revoke</button> : <span>Revoked</span>}</li>)}</ul>
        <h2 className="mb-2 font-medium">Audit</h2>
        <ul className="text-sm text-[hsl(var(--mute))]">{audit.slice(0, 12).map((item) => <li key={item.id}>{item.action}</li>)}</ul>
      </section>
    </div>
  );
}
