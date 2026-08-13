import type { ProviderName } from "@harness/config";

/**
 * One turn is one ordered stream of these events. If replaying the stream cannot reconstruct the
 * whole decision, something the agent relied on is missing from it.
 */

interface BaseEvent {
  turnId: string;
  conversationId: string;
  /** Our own tenancy, stamped by the tracer. Absent only on turns that predate it. */
  subAccountId?: string;
  agentId?: string;
  source: "live" | "eval";
  /** Monotonic within a turn. Wall-clock ties are common; ordering must not depend on `ts`. */
  seq: number;
  ts: string;
}

export interface TurnStartEvent extends BaseEvent {
  type: "turn_start";
  /** The debounced customer message(s) this turn is answering. */
  input: string;
  messageIds: string[];
}

export interface GateEvent extends BaseEvent {
  type: "gate";
  decision: "retrieve" | "skip";
  /** Which stage decided — the free heuristic or the gate model. */
  decidedBy: "heuristic" | "model" | "timeout_default";
  reason: string;
  /** The gate rewrites the customer's phrasing into a retrieval query when it retrieves. */
  rewrittenQuery?: string;
  latencyMs: number;
}

export interface RagRetrieveEvent extends BaseEvent {
  type: "rag_retrieve";
  query: string;
  chunks: Array<{ id: string; source: string; score: number }>;
  /** True when every chunk fell below the relevance floor and the agent must decline. */
  belowFloor: boolean;
  latencyMs: number;
}

export interface LlmCallEvent extends BaseEvent {
  type: "llm_call";
  role: "chat" | "gate" | "judge";
  provider: ProviderName;
  model: string;
  /** Present for the first attempt too, so a failover chain reads as attempt 1, 2, ... */
  attempt: number;
  /** The exact assembled prompt, not a summary — this is the transparency requirement. */
  prompt: unknown;
  completion?: string;
  toolCalls?: Array<{ name: string; args: unknown }>;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
}

export interface ProviderFailoverEvent extends BaseEvent {
  type: "provider_failover";
  from: { provider: ProviderName; model: string };
  to: { provider: ProviderName; model: string };
  reason: string;
}

export interface SkillGuardEvent extends BaseEvent {
  type: "skill_guard";
  skill: string;
  guard: string;
  passed: boolean;
  /** On failure this string goes back to the model verbatim as the tool observation. */
  reason?: string;
}

export interface ToolCallEvent extends BaseEvent {
  type: "tool_call";
  skill: string;
  args: unknown;
}

export interface ToolResultEvent extends BaseEvent {
  type: "tool_result";
  skill: string;
  outcome: "ok" | "failed" | "needs_input" | "blocked" | "handover";
  result: unknown;
  latencyMs: number;
}

export interface CrmCallEvent extends BaseEvent {
  type: "crm_call";
  method: string;
  path: string;
  status: number;
  latencyMs: number;
}

export interface HandoverEvent extends BaseEvent {
  type: "handover";
  trigger: "explicit_request" | "frustration" | "out_of_scope" | "repeated_failure" | "manual";
  /** The message(s) that justified the decision, so a false positive is auditable. */
  evidence: string[];
}

export interface TurnEndEvent extends BaseEvent {
  type: "turn_end";
  iterations: number;
  reply: string | null;
  /** Why the loop stopped: the model was done, or a guardrail cut it short. */
  stopReason: "completed" | "max_iterations" | "turn_budget" | "error";
  totalLatencyMs: number;
}

/**
 * The SLO clock: webhook received to reply accepted by the CRM. `turn_end` measures the loop only,
 * which is the smaller number and not the one the target is written about.
 */
export interface TurnSentEvent extends BaseEvent {
  type: "turn_sent";
  /** Webhook arrival to the send returning. Debounce included; it is real customer-visible time. */
  webhookToSendMs: number;
  /** How much of that was the CRM answering, so a slow vendor is not read as a slow harness. */
  crmMs: number;
  /** Which vendor answered, so actuals can be reported per provider without a join. */
  provider: string | null;
  retrieved: boolean;
}

export interface ErrorEvent extends BaseEvent {
  type: "error";
  stage: string;
  message: string;
  detail?: unknown;
}

export type TraceEvent =
  | TurnStartEvent
  | GateEvent
  | RagRetrieveEvent
  | LlmCallEvent
  | ProviderFailoverEvent
  | SkillGuardEvent
  | ToolCallEvent
  | ToolResultEvent
  | CrmCallEvent
  | HandoverEvent
  | TurnEndEvent
  | TurnSentEvent
  | ErrorEvent;

export type TraceEventType = TraceEvent["type"];

/** What a caller supplies; the tracer stamps `turnId`, `conversationId`, `seq`, and `ts`. */
export type TraceEventInput = TraceEvent extends infer E
  ? E extends TraceEvent
    ? Omit<E, keyof BaseEvent>
    : never
  : never;
