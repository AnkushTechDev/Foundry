"use client";

import { useParams } from "next/navigation";
import { PageBuilder } from "../../../../../components/builder/page-builder";

export default function PageEditor() {
  const { projectId, pageId } = useParams<{ projectId: string; pageId: string }>();
  return <PageBuilder projectId={projectId} pageId={pageId} />;
}
