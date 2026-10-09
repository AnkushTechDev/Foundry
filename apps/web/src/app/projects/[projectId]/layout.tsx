"use client";

import { useParams } from "next/navigation";
import { ProjectFrame } from "../../../components/shell";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ projectId: string }>();
  return <ProjectFrame projectId={params.projectId}>{children}</ProjectFrame>;
}
