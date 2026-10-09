"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

interface Overview {
  project: { id: string; name: string; description: string; authEnabled: boolean; publishedVersion: number; organizationSlug: string; slug: string };
  counts: { models: number; apis: number; pages: number; workflows: number; errors: number };
}

export default function OverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    api<Overview>(`/projects/${projectId}`).then(setData).catch(() => undefined);
  }, [projectId]);
  if (!data) return <div className="p-6 text-sm text-[hsl(var(--mute))]">Loading project…</div>;
  const steps = [
    [data.counts.models > 0, "Create a collection", `/projects/${projectId}/database`],
    [data.counts.apis > 0, "Generate a CRUD API", `/projects/${projectId}/database`],
    [data.counts.pages > 0, "Build a page", `/projects/${projectId}/pages`],
    [data.project.publishedVersion > 0, "Publish", `/projects/${projectId}/deployments`],
  ] as const;
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">{data.project.name}</h1>
      <p className="mt-1 text-sm text-[hsl(var(--mute))]">{data.project.description || "Design the data, APIs, workflows, and interface in one project."}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {Object.entries(data.counts).map(([key, value]) => (
          <div key={key} className="rounded-xl border border-[hsl(var(--line))] bg-[hsl(var(--panel))] p-4">
            <div className="text-xs capitalize text-[hsl(var(--mute))]">{key}</div>
            <div className="text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>
      <ol className="mt-8 grid gap-2">
        {steps.map(([done, label, href]) => (
          <li key={label}>
            <Link href={href} className="flex items-center gap-3 rounded-lg border border-[hsl(var(--line))] px-3 py-2 text-sm">
              <span className={`h-2.5 w-2.5 rounded-full ${done ? "bg-emerald-500" : "bg-[hsl(var(--line))]"}`} />
              {label}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
