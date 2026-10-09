"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppRenderer } from "../../../../components/runtime/renderer";
import { api } from "../../../../lib/api";
import type { ComponentNode, QueryDef } from "@foundry/shared";

interface ManifestPage {
  id: string;
  name: string;
  path: string;
  queries: QueryDef[];
  root: ComponentNode;
  variables?: Record<string, unknown>;
}

export default function EmbedPage() {
  const params = useParams<{ projectId: string; path?: string[] }>();
  const router = useRouter();
  const [pages, setPages] = useState<ManifestPage[]>([]);
  const path = `/${(params.path ?? []).join("/")}`.replace(/\/$/, "") || "/";
  useEffect(() => {
    api<{ pages: ManifestPage[] }>(`/projects/${params.projectId}/preview`).then((result) => setPages(result.pages)).catch(() => undefined);
  }, [params.projectId]);
  const page = pages.find((item) => item.path === path) ?? pages[0];
  if (!page) return <div className="p-8 text-sm">This preview has no pages yet.</div>;
  return (
    <AppRenderer
      page={page}
      pages={pages}
      target={{ mode: "draft", projectId: params.projectId }}
      onNavigate={(next) => router.push(`/embed/${params.projectId}${next === "/" ? "" : next}`)}
    />
  );
}
