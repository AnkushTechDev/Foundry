"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

export default function DeploymentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [data, setData] = useState<{ current: number; versions: Array<{ id: string; version: number; current: boolean; createdAt: string }> } | null>(null);
  const [message, setMessage] = useState("");
  async function load() {
    setData(await api(`/projects/${projectId}/deployments`));
  }
  useEffect(() => { void load(); }, [projectId]);
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Deployments</h1>
        <button className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white" onClick={async () => {
          const result = await api<{ version: number }>(`/projects/${projectId}/publish`, { method: "POST" });
          setMessage(`Published version ${result.version}. Draft edits stay off production until you publish again.`);
          await load();
        }}>Publish</button>
        {message ? <span className="text-sm text-[hsl(var(--mute))]">{message}</span> : null}
      </div>
      <p className="mb-4 text-sm text-[hsl(var(--mute))]">Current production version: {data?.current || "not published"}</p>
      <div className="grid gap-2">
        {data?.versions.map((version) => (
          <div key={version.id} className="flex items-center justify-between rounded-lg border border-[hsl(var(--line))] px-3 py-2 text-sm">
            <span>Version {version.version} {version.current ? "· live" : ""}</span>
            {!version.current ? <button className="text-[hsl(var(--accent))]" onClick={async () => { await api(`/projects/${projectId}/deployments/${version.id}/rollback`, { method: "POST" }); await load(); }}>Roll back</button> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
