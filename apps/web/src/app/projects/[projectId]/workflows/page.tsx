"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createId } from "@foundry/shared";
import { api } from "../../../../lib/api";

export default function WorkflowsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<Array<{ id: string; name: string; nodeCount: number }>>([]);
  useEffect(() => { api<typeof rows>(`/projects/${projectId}/workflows`).then(setRows).catch(() => undefined); }, [projectId]);
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Workflows</h1>
        <button className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white" onClick={async () => {
          const trigger = createId();
          const response = createId();
          const workflow = await api<{ id: string }>(`/projects/${projectId}/workflows`, {
            method: "POST",
            body: JSON.stringify({
              name: "New workflow",
              nodes: [
                { id: trigger, type: "httpTrigger", position: { x: 40, y: 80 }, data: { label: "HTTP Trigger", config: {} } },
                { id: response, type: "returnResponse", position: { x: 340, y: 80 }, data: { label: "Return", config: { statusCode: 200, body: { ok: true } } } },
              ],
              edges: [{ id: createId(), source: trigger, target: response, sourceHandle: "out" }],
            }),
          });
          location.href = `/projects/${projectId}/workflows/${workflow.id}`;
        }}>New workflow</button>
      </div>
      <div className="grid gap-2">
        {rows.map((row) => <Link key={row.id} className="rounded-lg border border-[hsl(var(--line))] px-4 py-3" href={`/projects/${projectId}/workflows/${row.id}`}>{row.name}<span className="ml-2 text-sm text-[hsl(var(--mute))]">{row.nodeCount} nodes</span></Link>)}
      </div>
    </div>
  );
}
