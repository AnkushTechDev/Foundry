"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } });

export function Providers({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export interface Session {
  id: string;
  email: string;
  name: string;
  organizations: Array<{ id: string; name: string; slug: string; plan: string; role?: string }>;
}

export function useSession() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Session>("/auth/me"), retry: false });
}

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await api(mode === "login" ? "/auth/login" : "/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          name: form.get("name"),
          organization: form.get("organization"),
        }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not continue");
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-2xl border border-[hsl(var(--line))] bg-[hsl(var(--panel))] p-8 shadow-lift">
        <div className="mb-6">
          <div className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--mute))]">Foundry</div>
          <h1 className="mt-2 text-2xl font-semibold">{mode === "login" ? "Welcome back" : "Create your workspace"}</h1>
        </div>
        {mode === "register" ? <Field name="name" label="Name" /> : null}
        {mode === "register" ? <Field name="organization" label="Organization" /> : null}
        <Field name="email" label="Email" type="email" />
        <Field name="password" label="Password" type="password" />
        {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
        <button disabled={pending} className="w-full rounded-md bg-[hsl(var(--accent))] py-2 text-sm font-medium text-white">{pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <p className="mt-4 text-sm text-[hsl(var(--mute))]">
          {mode === "login" ? <Link href="/register">Create an account</Link> : <Link href="/login">Already have an account</Link>}
        </p>
      </form>
    </main>
  );
}

function Field({ name, label, type = "text" }: { name: string; label: string; type?: string }) {
  return (
    <label className="mb-3 grid gap-1 text-sm">
      <span className="text-[hsl(var(--mute))]">{label}</span>
      <input required name={name} type={type} className="rounded-md border border-[hsl(var(--line))] bg-transparent px-3 py-2" />
    </label>
  );
}

const NAV = [
  ["overview", "Overview"],
  ["database", "Database"],
  ["apis", "APIs"],
  ["workflows", "Workflows"],
  ["pages", "Pages"],
  ["integrations", "Integrations"],
  ["ai", "AI Builder"],
  ["executions", "Executions"],
  ["deployments", "Deployments"],
  ["settings", "Settings"],
] as const;

export function ProjectFrame({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { data } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<{ project: { name: string; organizationSlug: string; slug: string; publishedVersion: number } }>(`/projects/${projectId}`),
  });
  return (
    <div className="grid min-h-screen grid-cols-[220px_1fr] grid-rows-[56px_1fr]">
      <header className="col-span-2 flex items-center gap-3 border-b border-[hsl(var(--line))] px-4">
        <Link href="/dashboard" className="text-sm font-semibold">Foundry</Link>
        <span className="text-[hsl(var(--mute))]">/</span>
        <span className="text-sm">{data?.project.name ?? "Project"}</span>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {data?.project.publishedVersion ? <a className="rounded-md border border-[hsl(var(--line))] px-2 py-1" href={`/apps/${data.project.organizationSlug}/${data.project.slug}`} target="_blank">Published v{data.project.publishedVersion}</a> : null}
          <ThemeToggle />
        </div>
      </header>
      <aside className="border-r border-[hsl(var(--line))] p-3">
        <nav className="grid gap-1">
          {NAV.map(([slug, label]) => {
            const href = slug === "overview" ? `/projects/${projectId}` : `/projects/${projectId}/${slug}`;
            const active = slug === "overview" ? pathname === href : pathname.startsWith(href);
            return <Link key={slug} href={href} className={`rounded-md px-2 py-1.5 text-sm ${active ? "bg-[hsl(var(--accent)/0.15)]" : "hover:bg-[hsl(var(--line)/0.4)]"}`}>{label}</Link>;
          })}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem("foundry-theme");
    const next = stored ? stored === "dark" : true;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  }, []);
  return (
    <button
      className="rounded-md border border-[hsl(var(--line))] px-2 py-1"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("foundry-theme", next ? "dark" : "light");
      }}
    >
      {dark ? "Light" : "Dark"}
    </button>
  );
}

export function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return <div className="rounded-xl border border-dashed border-[hsl(var(--line))] p-8 text-sm"><strong>{title}</strong><p className="mt-1 text-[hsl(var(--mute))]">{body}</p></div>;
}
