import type { ModelBinding, Settings } from "@harness/config";
import { z } from "zod";
import { callModel } from "../providers/call.js";
import type { ModelResolver } from "../providers/registry.js";
import type { Tracer } from "../tracing/tracer.js";

export interface GateDecision {
  retrieve: boolean;
  /** Which stage decided, so a trace shows whether this cost a model call. */
  decidedBy: "heuristic" | "model" | "timeout_default";
  reason: string;
  /** The customer's words rewritten as something worth searching for. */
  /** One per distinct question. Retrieval searches each and merges what clears the floor. */
  queries?: string[];
}

/**
 * Openers and acknowledgements. Matched whole, and only when the message is short — "thanks, but
 * do you do implants?" is a question wearing a greeting.
 */
const TRIVIAL =
  /^(hi|hey|hello|yo|good (morning|afternoon|evening)|thanks|thank you|ta|cheers|ok|okay|great|perfect|sure|yes|yeah|no|nope|bye|goodbye)[!.?]*$/i;

/**
 * Messages that ask the agent to *do* something.
 *
 * Caught for free rather than sent to the gate model, because the brief is explicit that
 * skill-only turns must not hit the vector store, and a paid call to establish that is the
 * expensive way to reach an answer a regex already knows.
 */
const ACTION_ONLY =
  /^(?:(?:can|could|will|would|please)\s+)?(?:you\s+)?(?:book|schedule|cancel|reschedule|move|change|update|save|change)\b/i;

/** `queries` is plural: one per question asked. See architecture.md#multi-query. */
const gateReplySchema = z.object({
  retrieve: z.boolean(),
  reason: z.string().default(""),
  query: z.string().default(""),
  queries: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Decides whether this turn needs the knowledge base at all.
 * Two stages, cheapest first: a free heuristic, then a model. See #retrieval-gate.
 */
/** Accepts a bare string too, so a stale model reply still produces a usable search. */
function normaliseQueries(reply: {
  query: string;
  queries?: string | string[] | undefined;
}): string[] | null {
  const raw = reply.queries ?? reply.query;
  const list = (typeof raw === "string" ? [raw] : raw).map((entry) => entry.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

export async function decideRetrieval(
  input: { text: string; hasPendingAction: boolean },
  settings: Settings,
  registry: ModelResolver,
  tracer: Tracer,
): Promise<GateDecision> {
  const startedAt = Date.now();

  const emit = (decision: GateDecision): GateDecision => {
    tracer.emit({
      type: "gate",
      decision: decision.retrieve ? "retrieve" : "skip",
      decidedBy: decision.decidedBy,
      reason: decision.reason,
      ...(decision.queries?.length ? { rewrittenQuery: decision.queries.join(" | ") } : {}),
      latencyMs: Date.now() - startedAt,
    });
    return decision;
  };

  const text = input.text.trim();

  if (TRIVIAL.test(text)) {
    return emit({ retrieve: false, decidedBy: "heuristic", reason: "greeting or acknowledgement" });
  }
  if (text.length < 3) {
    return emit({ retrieve: false, decidedBy: "heuristic", reason: "too short to be a question" });
  }
  if (ACTION_ONLY.test(text)) {
    return emit({
      retrieve: false,
      decidedBy: "heuristic",
      reason: "asking the agent to do something, not to know something",
    });
  }
  if (input.hasPendingAction) {
    // Mid-booking, "9:30 works" is an answer to the agent, not a question for the knowledge base.
    return emit({
      retrieve: false,
      decidedBy: "heuristic",
      reason: "mid-action; this is a reply to the agent rather than a question",
    });
  }

  try {
    const reply = await withTimeout(
      askGate(text, settings, settings.model.gate, registry, tracer),
      settings.knowledge.gateTimeoutMs,
    );
    const queries = normaliseQueries(reply);
    return emit({
      retrieve: reply.retrieve,
      decidedBy: "model",
      reason: reply.reason,
      ...(queries ? { queries } : {}),
    });
  } catch (error) {
    // A slow or broken gate must not decide the turn. Which way it fails is the operator's call:
    // retrieving needlessly costs latency, skipping needlessly costs a correct answer.
    return emit({
      retrieve: settings.knowledge.gateFailOpen,
      decidedBy: "timeout_default",
      reason: error instanceof Error ? error.message : String(error),
      ...(settings.knowledge.gateFailOpen ? { queries: [text] } : {}),
    });
  }
}

async function askGate(
  text: string,
  settings: Settings,
  binding: ModelBinding,
  registry: ModelResolver,
  tracer: Tracer,
): Promise<z.infer<typeof gateReplySchema>> {
  const result = await callModel(
    {
      role: "gate",
      chain: [binding],
      system: gatePrompt(settings),
      messages: [{ role: "user", content: text }],
    },
    registry,
    tracer,
  );

  const parsed = gateReplySchema.safeParse(JSON.parse(extractJson(result.text)));
  if (!parsed.success)
    throw new Error(`gate returned unusable output: ${result.text.slice(0, 120)}`);
  return parsed.data;
}

function gatePrompt(settings: Settings): string {
  const eagerness = {
    low: "Only retrieve when the question is clearly about the business's own documented information.",
    balanced:
      "Retrieve when the answer would plausibly be written down somewhere by this business.",
    high: "Retrieve unless the message clearly needs no information at all.",
  }[settings.knowledge.retrievalAggressiveness];

  return [
    `Might ${settings.businessName}'s own written documents contain something relevant to this message?`,
    // The distinction the gate kept getting wrong: it was deciding whether the agent *should*
    // answer rather than whether the documents *might cover it*. Those come apart exactly where
    // it matters — a clinical or subjective question is one the agent must not answer from
    // general knowledge, which makes checking the documents more important, not less.
    "You are not deciding whether to answer, whether the question is appropriate, or whether you know. Only whether a document might be relevant. Deciding there is no answer happens after the search, not here.",
    eagerness,
    "Yes for: prices, times, policies, what a treatment involves, what to do in a situation, anything a business writes down for its customers.",
    "Yes even when the question sounds clinical, subjective, or like something you should not answer. Search first.",
    "No only for: greetings, thanks, confirmations, a customer giving their own details, or asking you to perform an action.",
    'JSON only, no prose, no code fence: {"retrieve":true,"reason":"3 words","queries":["search phrase"]}',
    'queries is what you would actually search for: "do you guys do refunds tho" -> ["refund policy"]. Empty array when not retrieving.',
    "One entry per distinct question. Somebody asking two things in one message needs two searches, or the second gets no passages and the agent wrongly says it does not know.",
    // Few-shot examples drawn from the awkward cases rather than the obvious ones. The gate does
    // not need showing that "hi" is chit-chat; it needs showing that a question wearing a
    // greeting is still a question, and that a request to act is not a request to know.
    [
      "Examples:",
      '"hi, how much is a filling?" -> {"retrieve":true,"reason":"pricing","queries":["filling cost"]}',
      '"what time do you close friday and how much is a check-up?" -> {"retrieve":true,"reason":"hours and pricing","queries":["Friday opening hours","check-up cost"]}',
      '"thanks! and do you do implants?" -> {"retrieve":true,"reason":"treatment offered","queries":["dental implants"]}',
      '"book me in for tuesday" -> {"retrieve":false,"reason":"asking to act","queries":[]}',
      '"9:30 works" -> {"retrieve":false,"reason":"choosing an offered slot","queries":[]}',
      '"I\'m Priya, priya@x.com" -> {"retrieve":false,"reason":"giving own details","queries":[]}',
      '"what\'s your refund policy?" -> {"retrieve":true,"reason":"policy question","queries":["refund policy"]}',
      '"does it hurt?" -> {"retrieve":true,"reason":"what treatment involves","queries":["pain during treatment"]}',
      '"what do you think I should do?" -> {"retrieve":false,"reason":"asking for an opinion","queries":[]}',
      '"what if I\'m running late" -> {"retrieve":true,"reason":"policy on lateness","queries":["arriving late for an appointment"]}',
      '"are x-rays safe in pregnancy?" -> {"retrieve":true,"reason":"may be documented","queries":["x-rays during pregnancy"]}',
      '"which dentist is best for veneers?" -> {"retrieve":true,"reason":"may be documented","queries":["dentists and veneers"]}',
    ].join("\n"),
  ].join("\n");
}

/** Models wrap JSON in prose or fences often enough that trusting the raw string is a bug. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text.trim();
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`gate exceeded its ${ms}ms budget`));
      }, ms).unref();
    }),
  ]);
}
