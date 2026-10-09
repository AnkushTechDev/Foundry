"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createId, NODE_TYPES, type NodeType, type WorkflowDef } from "@foundry/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { cn, formatMs } from "../../lib/utils";

const GROUPS: Array<{ name: string; types: NodeType[] }> = [
  { name: "Triggers", types: ["httpTrigger", "webhookTrigger", "scheduleTrigger", "manualTrigger"] },
  { name: "Database", types: ["findOne", "findMany", "createRecord", "updateRecord", "deleteRecord", "countRecords", "aggregate"] },
  { name: "Logic", types: ["condition", "switch", "loop", "delay", "merge", "setVariable", "transform", "validate"] },
  { name: "HTTP", types: ["httpRequest"] },
  { name: "Utility", types: ["jsonParse", "jsonTransform", "stringTransform", "dateTransform", "math", "generateUuid"] },
  { name: "AI", types: ["llmPrompt"] },
  { name: "Output", types: ["returnResponse", "throwError"] },
];

const LABELS: Record<string, string> = {
  httpTrigger: "HTTP Trigger",
  webhookTrigger: "Webhook",
  scheduleTrigger: "Schedule",
  manualTrigger: "Manual",
  findOne: "Find One",
  findMany: "Find Many",
  createRecord: "Create Record",
  updateRecord: "Update Record",
  deleteRecord: "Delete Record",
  countRecords: "Count",
  aggregate: "Aggregate",
  condition: "Condition",
  switch: "Switch",
  loop: "Loop",
  delay: "Delay",
  merge: "Merge",
  setVariable: "Set Variable",
  transform: "Transform",
  validate: "Validate",
  httpRequest: "HTTP Request",
  jsonParse: "JSON Parse",
  jsonTransform: "JSON Transform",
  stringTransform: "String",
  dateTransform: "Date",
  math: "Math",
  generateUuid: "UUID",
  llmPrompt: "LLM Prompt",
  returnResponse: "Return",
  throwError: "Throw Error",
};

type FlowNode = Node<{ label: string; nodeType: string; config: Record<string, unknown>; status?: string }>;

function StudioNode({ data, selected }: NodeProps<FlowNode>) {
  const branches = data.nodeType === "condition" ? ["true", "false"] : data.nodeType === "validate" ? ["valid", "invalid"] : ["out"];
  return (
    <div className={cn("min-w-40 rounded-lg border bg-[hsl(var(--panel))] px-3 py-2 text-xs shadow-lift", selected ? "border-[hsl(var(--accent))]" : "border-[hsl(var(--line))]", data.status === "success" && "border-emerald-500", data.status === "error" && "border-red-500")}>
      <Handle type="target" position={Position.Left} />
      <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--mute))]">{LABELS[data.nodeType] ?? data.nodeType}</div>
      <div className="font-medium">{data.label}</div>
      {branches.map((branch, index) => (
        <Handle key={branch} id={branch} type="source" position={Position.Right} style={{ top: branches.length === 1 ? "50%" : `${30 + index * 40}%` }} />
      ))}
    </div>
  );
}

const nodeTypes = { studio: StudioNode };

function toFlow(workflow: WorkflowDef): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: "studio",
      position: node.position,
      data: { label: node.data.label, nodeType: node.type, config: node.data.config ?? {} },
    })),
    edges: workflow.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle })),
  };
}

export function WorkflowEditor({ projectId, workflowId }: { projectId: string; workflowId: string }) {
  const [name, setName] = useState("Workflow");
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [body, setBody] = useState('{\n  "email": "ada@example.com"\n}');
  const [logs, setLogs] = useState<Array<{ nodeId: string; label: string; status: string; durationMs: number; error?: string; output: unknown }>>([]);
  const [response, setResponse] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      api<WorkflowDef & { id: string }>(`/projects/${projectId}/workflows/${workflowId}`),
      api<Array<{ id: string; name: string }>>(`/projects/${projectId}/models`),
    ]).then(([workflow, collections]) => {
      const flow = toFlow(workflow);
      setName(workflow.name);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setModels(collections);
      setReady(true);
    }).catch(() => undefined);
  }, [projectId, workflowId]);

  const payload = useMemo<WorkflowDef>(() => ({
    name,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.nodeType as (typeof NODE_TYPES)[number],
      position: node.position,
      data: { label: node.data.label, config: node.data.config },
    })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? undefined })),
  }), [name, nodes, edges]);

  useEffect(() => {
    if (!ready || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      api(`/projects/${projectId}/workflows/${workflowId}`, { method: "PATCH", body: JSON.stringify(payload) })
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("unsaved"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [payload, ready, saveState, projectId, workflowId]);

  const onNodesChange: OnNodesChange<FlowNode> = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
    if (changes.some((change) => change.type === "position" || change.type === "remove")) setSaveState("unsaved");
  }, []);
  const onEdgesChange: OnEdgesChange = useCallback((changes) => {
    setEdges((current) => applyEdgeChanges(changes, current));
    if (changes.some((change) => change.type === "remove")) setSaveState("unsaved");
  }, []);
  const onConnect = useCallback((connection: Connection) => {
    setEdges((current) => addEdge({ ...connection, id: createId() }, current));
    setSaveState("unsaved");
  }, []);

  function addNode(type: NodeType) {
    const id = createId();
    setNodes((current) => [...current, {
      id,
      type: "studio",
      position: { x: 80 + current.length * 40, y: 80 + current.length * 24 },
      data: { label: LABELS[type] ?? type, nodeType: type, config: {} },
    }]);
    setSelected(id);
    setSaveState("unsaved");
  }

  const selectedNode = nodes.find((node) => node.id === selected);

  async function run() {
    let parsed: unknown = {};
    try { parsed = JSON.parse(body); } catch { setResponse("Body must be JSON"); return; }
    const result = await api<{ statusCode: number; body: unknown; durationMs: number; logs: typeof logs; status: string }>(`/projects/${projectId}/workflows/${workflowId}/execute`, {
      method: "POST",
      body: JSON.stringify({ body: parsed }),
    });
    setLogs(result.logs);
    setResponse(`${result.statusCode} in ${formatMs(result.durationMs)}\n${JSON.stringify(result.body, null, 2)}`);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, status: result.logs.find((log) => log.nodeId === node.id)?.status } })));
  }

  return (
    <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[220px_1fr_300px] grid-rows-[1fr_200px]">
      <aside className="row-span-2 overflow-auto border-r border-[hsl(var(--line))] p-3">
        {GROUPS.map((group) => (
          <div key={group.name} className="mb-4">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-[hsl(var(--mute))]">{group.name}</div>
            {group.types.map((type) => <button key={type} className="mb-1 block w-full rounded-md border border-[hsl(var(--line))] px-2 py-1 text-left text-xs" onClick={() => addNode(type)}>{LABELS[type]}</button>)}
          </div>
        ))}
      </aside>
      <div className="relative">
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <input className="rounded-md border border-[hsl(var(--line))] bg-[hsl(var(--panel))] px-2 py-1 text-sm" value={name} onChange={(event) => { setName(event.target.value); setSaveState("unsaved"); }} />
          <span className="text-xs text-[hsl(var(--mute))]">{saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : "Saved"}</span>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={({ nodes: selectedNodes }) => setSelected(selectedNodes[0]?.id ?? null)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <aside className="row-span-2 overflow-auto border-l border-[hsl(var(--line))] p-3 text-sm">
        {selectedNode ? (
          <NodeConfig
            node={selectedNode}
            models={models}
            onChange={(config, label) => {
              setNodes((current) => current.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, config, label } } : node));
              setSaveState("unsaved");
            }}
          />
        ) : <p className="text-[hsl(var(--mute))]">Select a node to configure it.</p>}
      </aside>
      <section className="grid grid-cols-2 border-t border-[hsl(var(--line))]">
        <div className="border-r border-[hsl(var(--line))] p-3">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-[hsl(var(--mute))]">
            Test input
            <button className="rounded bg-[hsl(var(--accent))] px-2 py-1 text-white" onClick={() => void run()}>Run</button>
          </div>
          <textarea className="h-28 w-full rounded-md border border-[hsl(var(--line))] bg-transparent p-2 font-mono text-xs" value={body} onChange={(event) => setBody(event.target.value)} />
        </div>
        <pre className="overflow-auto p-3 font-mono text-xs">{response || logs.map((log) => `${log.status === "success" ? "●" : "○"} ${log.label}  ${formatMs(log.durationMs)}  ${log.error ?? log.status}`).join("\n")}</pre>
      </section>
    </div>
  );
}

function NodeConfig({ node, models, onChange }: { node: FlowNode; models: Array<{ id: string; name: string }>; onChange: (config: Record<string, unknown>, label: string) => void }) {
  const config = node.data.config;
  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value }, node.data.label);
  }
  const type = node.data.nodeType;
  return (
    <div className="grid gap-2">
      <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={node.data.label} onChange={(event) => onChange(config, event.target.value)} />
      {["findOne", "findMany", "createRecord", "updateRecord", "deleteRecord", "countRecords", "aggregate"].includes(type) ? (
        <select className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={String(config.modelId ?? "")} onChange={(event) => set("modelId", event.target.value)}>
          <option value="">Collection</option>
          {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      ) : null}
      {type === "findMany" ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(config.filterFromQuery)} onChange={(event) => set("filterFromQuery", event.target.checked)} />Filter from query string</label> : null}
      {["findOne", "updateRecord", "deleteRecord"].includes(type) ? <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1 font-mono text-xs" placeholder="{{trigger.params.id}}" value={String(config.id ?? "")} onChange={(event) => set("id", event.target.value)} /> : null}
      {["createRecord", "updateRecord", "transform", "jsonTransform"].includes(type) ? <textarea className="min-h-24 rounded border border-[hsl(var(--line))] bg-transparent p-2 font-mono text-xs" value={typeof (config.data ?? config.mapping) === "string" ? String(config.data ?? config.mapping) : JSON.stringify(config.data ?? config.mapping ?? {}, null, 2)} onChange={(event) => {
        const key = type === "transform" || type === "jsonTransform" ? "mapping" : "data";
        try { set(key, JSON.parse(event.target.value)); } catch { set(key, event.target.value); }
      }} /> : null}
      {type === "condition" ? (
        <>
          <select className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={String(config.operator ?? "exists")} onChange={(event) => set("operator", event.target.value)}>
            {["exists", "empty", "eq", "neq", "contains", "expression"].map((op) => <option key={op}>{op}</option>)}
          </select>
          <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1 font-mono text-xs" placeholder="{{nodes.find.output}}" value={String(config.value ?? config.expression ?? "")} onChange={(event) => set(config.operator === "expression" ? "expression" : "value", event.target.value)} />
        </>
      ) : null}
      {type === "httpRequest" ? (
        <>
          <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" placeholder="https://api.example.com" value={String(config.url ?? "")} onChange={(event) => set("url", event.target.value)} />
          <input className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" placeholder="GET" value={String(config.method ?? "GET")} onChange={(event) => set("method", event.target.value)} />
        </>
      ) : null}
      {type === "returnResponse" ? (
        <>
          <input type="number" className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={Number(config.statusCode ?? 200)} onChange={(event) => set("statusCode", Number(event.target.value))} />
          <textarea className="min-h-24 rounded border border-[hsl(var(--line))] bg-transparent p-2 font-mono text-xs" value={typeof config.body === "string" ? config.body : JSON.stringify(config.body ?? {}, null, 2)} onChange={(event) => {
            try { set("body", JSON.parse(event.target.value)); } catch { set("body", event.target.value); }
          }} />
        </>
      ) : null}
      {type === "llmPrompt" ? <textarea className="min-h-24 rounded border border-[hsl(var(--line))] bg-transparent p-2 text-xs" value={String(config.prompt ?? "")} onChange={(event) => set("prompt", event.target.value)} /> : null}
      {type === "scheduleTrigger" ? (
        <select className="rounded border border-[hsl(var(--line))] bg-transparent px-2 py-1" value={String(config.every ?? "day")} onChange={(event) => set("every", event.target.value)}>
          <option value="hour">Every hour</option>
          <option value="day">Every day at 9:00</option>
          <option value="week">Every Monday at 9:00</option>
        </select>
      ) : null}
      {type === "validate" ? <textarea className="min-h-24 rounded border border-[hsl(var(--line))] bg-transparent p-2 font-mono text-xs" value={JSON.stringify(config.rules ?? [{ field: "email", required: true, type: "string" }], null, 2)} onChange={(event) => { try { set("rules", JSON.parse(event.target.value)); } catch { /* keep typing */ } }} /> : null}
    </div>
  );
}
