import type { TraceEventRow } from "./api";

/**
 * Which part of the drawing each event lights up.
 *
 * This map and the ids in `PipelineDiagram.vue` are two halves of one contract — Waku freezes its
 * equivalent for exactly this reason. Adding a trace event without adding it here means the turn
 * replays with a gap and nobody notices, so a new event type belongs in both files or neither.
 */
export const STAGE: Record<string, { nodes: string[]; edges: string[]; label: string }> = {
  turn_start: { nodes: ["webhook", "dedupe"], edges: ["e-in", "e-dedupe"], label: "message in" },
  gate: { nodes: ["gate"], edges: [], label: "retrieval gate decides" },
  rag_retrieve: {
    nodes: ["retrieve", "kb"],
    edges: ["e-retrieve", "e-kb", "e-ctx"],
    label: "reads the knowledge base",
  },
  llm_call: { nodes: ["model"], edges: [], label: "model reasons" },
  provider_failover: { nodes: ["failover"], edges: ["e-failover"], label: "switched provider" },
  skill_guard: { nodes: ["skills"], edges: ["e-act"], label: "guard checked" },
  tool_call: { nodes: ["skills"], edges: ["e-act"], label: "skill runs" },
  tool_result: { nodes: ["skills"], edges: ["e-obs"], label: "skill returns" },
  crm_call: { nodes: ["crm"], edges: ["e-out"], label: "CRM round trip" },
  handover: { nodes: ["handover"], edges: ["e-handover"], label: "fetches a person" },
  turn_end: { nodes: ["crm", "trace"], edges: ["e-out", "e-trace"], label: "reply sent" },
  error: { nodes: [], edges: [], label: "failed" },
};

/** The gate skipping is the one decision with no event of its own to light a node. */
export function nodesUpTo(events: TraceEventRow[], index: number): string[] {
  const seen = new Set<string>();
  events.slice(0, index + 1).forEach((event) => {
    STAGE[event.type]?.nodes.forEach((node) => seen.add(node));
    STAGE[event.type]?.edges.forEach((edge) => seen.add(edge));
  });
  return [...seen];
}

export function nodesAt(event: TraceEventRow | undefined): string[] {
  if (!event) return [];
  const stage = STAGE[event.type];
  return stage ? [...stage.nodes, ...stage.edges] : [];
}

/** A failing stage should be red where it failed, not red everywhere. */
export function failedNodes(events: TraceEventRow[]): string[] {
  return events
    .filter((event) => event.type === "error")
    .flatMap((event) => {
      const raw = event.payload["stage"];
      const stage = typeof raw === "string" ? raw : "";
      if (stage.includes("gate")) return ["gate"];
      if (stage.includes("chat") || stage.includes("llm")) return ["model"];
      if (stage.includes("tool") || stage.includes("skill")) return ["skills"];
      if (stage.includes("crm") || stage.includes("send")) return ["crm"];
      return ["model"];
    });
}
