"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ComponentNode, QueryDef } from "@foundry/shared";
import { AppRenderer } from "../../../../../components/runtime/renderer";
import { runtimeRequest } from "../../../../../lib/api";

interface ManifestPage {
  name: string;
  path: string;
  queries?: QueryDef[];
  root: ComponentNode;
  variables?: Record<string, unknown>;
}

export default function PublishedApp() {
  const params = useParams<{ orgSlug: string; projectSlug: string; path?: string[] }>();
  const router = useRouter();
  const [pages, setPages] = useState<ManifestPage[]>([]);
  const [missing, setMissing] = useState(false);
  const current = `/${(params.path ?? []).join("/")}`.replace(/\/$/, "") || "/";
  useEffect(() => {
    runtimeRequest(`/runtime/apps/${params.orgSlug}/${params.projectSlug}/manifest`).then((result) => {
      if (result.status >= 400) setMissing(true);
      else setPages((result.body as { pages: ManifestPage[] }).pages ?? []);
    }).catch(() => setMissing(true));
  }, [params.orgSlug, params.projectSlug]);
  if (missing) return <div className="grid min-h-screen place-items-center text-sm">This app is not published.</div>;
  const page = pages.find((item) => item.path === current) ?? pages[0];
  if (!page) return <div className="p-8 text-sm">Loading app…</div>;
  return (
    <AppRenderer
      page={page}
      pages={pages.map((item) => ({ path: item.path, name: item.name }))}
      target={{ mode: "published", orgSlug: params.orgSlug, projectSlug: params.projectSlug }}
      onNavigate={(next) => router.push(`/apps/${params.orgSlug}/${params.projectSlug}${next === "/" ? "" : next}`)}
    />
  );
}
