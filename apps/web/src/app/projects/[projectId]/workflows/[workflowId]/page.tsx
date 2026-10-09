"use client";

import { useParams } from "next/navigation";
import { WorkflowEditor } from "../../../../../components/workflow/editor";

export default function WorkflowPage() {
  const { projectId, workflowId } = useParams<{ projectId: string; workflowId: string }>();
  return <WorkflowEditor projectId={projectId} workflowId={workflowId} />;
}
