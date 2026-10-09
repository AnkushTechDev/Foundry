"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { formatMs } from "../../../../lib/utils";

export default function ExecutionsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [rows, setRows] = useState<Array<{ id: string; status: string; source: string; durationMs: number; responseStatus: number; startedAt: string }>>([]);
  const [detail, setDetail] = useState<{ logs: Array<{ label: string; status: string; durationMs: number; error: string }> } | null>(null);
  useEffect(() => { api<typeof rows>(`/projects/${projectId}/executions`).then(setRows).catch(() => undefined); }, [projectId]);
  return (
    <div className="grid h-full grid-cols-[1fr_1fr]">
      <section className="border-r border-[hsl(var(--line))] p-4">
        <h1 className="mb-3 text-xl font-semibold">Executions</h1>
        {rows.map((row) => (
          <button key={row.id} className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-[hsl(var(--line)/0.35)]" onClick={() => api<NonNullable<typeof detail>>(`/projects/${projectId}/executions/${row.id}`).then(setDetail)}>
            <span className={row.status === "success" ? "text-emerald-500" : "text-red-500"}>{row.status}</span>
            <span>{row.source}</span>
            <span className="font-mono text-xs">{row.responseStatus} · {formatMs(row.durationMs)}</span>
          </button>
        ))}
      </section>
      <pre className="overflow-auto p-4 font-mono text-xs">{detail ? detail.logs.map((log) => `${log.status.padEnd(8)} ${formatMs(log.durationMs).padStart(8)}  ${log.label} ${log.error ?? ""}`).join("\n") : "Select an execution."}</pre>
    </div>
  );
}
