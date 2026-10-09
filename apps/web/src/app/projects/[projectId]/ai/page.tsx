"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../lib/api";

export default function AiPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [prompt, setPrompt] = useState("Create a CRM where companies have name, website and industry. Contacts have name and email. Deals have value, status and expected close date.");
  const [result, setResult] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">AI builder</h1>
      <p className="mt-1 text-sm text-[hsl(var(--mute))]">Describe the app. Foundry turns it into collections, CRUD APIs, and editable pages. With an OpenAI-compatible key it asks a model for JSON and validates it. Without a key, a local planner does the same job.</p>
      <textarea className="mt-4 h-40 w-full rounded-xl border border-[hsl(var(--line))] bg-transparent p-3" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      <button disabled={pending} className="mt-3 rounded-md bg-[hsl(var(--accent))] px-3 py-2 text-sm text-white" onClick={async () => {
        setPending(true);
        try {
          const generated = await api<{ created: Array<{ model: { name: string }; page: { id: string } }> }>(`/projects/${projectId}/ai/generate`, { method: "POST", body: JSON.stringify({ prompt }) });
          setResult(generated.created.map((item) => item.model.name).join(", "));
          const first = generated.created[0]?.page.id;
          if (first) router.push(`/projects/${projectId}/pages/${first}`);
        } catch (error) {
          setResult(error instanceof Error ? error.message : "Generation failed");
        } finally {
          setPending(false);
        }
      }}>{pending ? "Generating…" : "Generate"}</button>
      {result ? <p className="mt-3 text-sm">{result}</p> : null}
    </div>
  );
}
