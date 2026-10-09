"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { blankPage } from "../../../../lib/tree";

export default function PagesIndex() {
  const { projectId } = useParams<{ projectId: string }>();
  const [pages, setPages] = useState<Array<{ id: string; name: string; path: string }>>([]);
  useEffect(() => { api<typeof pages>(`/projects/${projectId}/pages`).then(setPages).catch(() => undefined); }, [projectId]);
  async function create() {
    const page = await api<{ id: string }>(`/projects/${projectId}/pages`, { method: "POST", body: JSON.stringify(blankPage("Customers")) });
    location.href = `/projects/${projectId}/pages/${page.id}`;
  }
  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between"><h1 className="text-xl font-semibold">Pages</h1><button className="rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white" onClick={() => void create()}>New page</button></div>
      <div className="grid gap-2">
        {pages.map((page) => <Link key={page.id} href={`/projects/${projectId}/pages/${page.id}`} className="rounded-lg border border-[hsl(var(--line))] px-4 py-3">{page.name}<span className="ml-2 text-sm text-[hsl(var(--mute))]">{page.path}</span></Link>)}
      </div>
    </div>
  );
}
