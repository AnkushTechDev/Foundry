"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle, useSession } from "../../components/shell";
import { api } from "../../lib/api";

interface DashboardData {
  organizations: Array<{ id: string; name: string; plan: string }>;
  projects: Array<{ id: string; name: string; description: string; publishedVersion: number; updatedAt: string }>;
  usage: { plan: string; projectCount: number; published: number; apiCalls: number; workflowExecutions: number; limits: { projects: number; publishedApps: number; apiCalls: number } } | null;
  errors: number;
}

export default function DashboardPage() {
  const session = useSession();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string; category: string }>>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (session.isError) router.replace("/login");
  }, [session.isError, router]);

  useEffect(() => {
    if (!session.data) return;
    api<DashboardData>("/dashboard").then(setData).catch(() => undefined);
    api<typeof templates>("/templates").then(setTemplates).catch(() => undefined);
  }, [session.data]);

  const orgId = session.data?.organizations[0]?.id;

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    if (!orgId) return;
    const project = await api<{ id: string }>("/projects", { method: "POST", body: JSON.stringify({ organizationId: orgId, name }) });
    router.push(`/projects/${project.id}`);
  }

  async function useTemplate(templateId: string) {
    if (!orgId) return;
    try {
      const project = await api<{ id: string }>(`/templates/${templateId}/use`, { method: "POST", body: JSON.stringify({ organizationId: orgId }) });
      router.push(`/projects/${project.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not use template");
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-[hsl(var(--mute))]">Foundry</div>
          <h1 className="text-2xl font-semibold">{session.data ? `Hello, ${session.data.name.split(" ")[0]}` : "Workspace"}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button className="text-sm text-[hsl(var(--mute))]" onClick={() => api("/auth/logout", { method: "POST" }).then(() => router.push("/login"))}>Sign out</button>
        </div>
      </header>
      <section className="mb-8 grid gap-3 sm:grid-cols-4">
        <Stat label="Projects" value={`${data?.usage?.projectCount ?? 0}/${data?.usage?.limits.projects ?? "–"}`} />
        <Stat label="Published" value={`${data?.usage?.published ?? 0}`} />
        <Stat label="API calls" value={`${data?.usage?.apiCalls ?? 0}`} />
        <Stat label="Errors" value={`${data?.errors ?? 0}`} />
      </section>
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <h2 className="mb-3 font-medium">Projects</h2>
          <div className="grid gap-2">
            {data?.projects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="rounded-xl border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-4 py-3">
                <div className="font-medium">{project.name}</div>
                <div className="text-sm text-[hsl(var(--mute))]">{project.description || "No description"} {project.publishedVersion ? `· v${project.publishedVersion}` : ""}</div>
              </Link>
            ))}
            {!data?.projects.length ? <p className="text-sm text-[hsl(var(--mute))]">No projects yet.</p> : null}
          </div>
        </section>
        <section>
          <h2 className="mb-3 font-medium">New project</h2>
          <form onSubmit={createProject} className="mb-6 flex gap-2">
            <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="Customer Manager" className="flex-1 rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" />
            <button className="rounded-md bg-[hsl(var(--accent))] px-3 text-sm text-white">Create</button>
          </form>
          {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
          <h2 className="mb-3 font-medium">Templates</h2>
          <div className="grid gap-2">
            {templates.map((template) => (
              <button key={template.id} onClick={() => void useTemplate(template.id)} className="rounded-xl border border-[hsl(var(--line))] px-4 py-3 text-left">
                <div className="text-xs uppercase tracking-wide text-[hsl(var(--mute))]">{template.category}</div>
                <div className="font-medium">{template.name}</div>
                <div className="text-sm text-[hsl(var(--mute))]">{template.description}</div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[hsl(var(--line))] bg-[hsl(var(--panel))] p-4"><div className="text-xs text-[hsl(var(--mute))]">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div></div>;
}
