import type { Settings } from "@harness/config";
import type { z } from "zod";
import type { Tracer } from "../tracing/tracer.js";

/**
 * What a skill is handed when it runs. Deliberately narrow: a skill gets the conversation it is
 * acting on, the operator's settings, and a tracer — never the loop, never the provider. That is
 * what keeps "add a skill" to one new file.
 */
/**
 * Something this conversation established, worth carrying to the next turn — episodic, not
 * semantic. Staleness is a common attribute of one, not the definition. See #memory.
 */
export interface EpisodicNote {
  kind: string;
  at: string;
  /** Written for the model to read back verbatim, not for a log. */
  detail: string;
  /**
   * How long this stays reliable, in minutes. Omitted means it never goes stale.
   *
   * Declared by the skill that recorded it, because only that skill knows: free slots can be
   * taken by someone else within minutes, while an appointment that was booked stays booked and
   * a preference the customer stated stays stated. Leaving the judgement to the model instead
   * produces an agent that either re-checks everything or trusts a slot from last Tuesday.
   */
  staleAfterMinutes?: number;
}

export interface SkillContext {
  locationId: string;
  contactId: string;
  conversationId: string;
  settings: Settings;
  tracer: Tracer;
  /** Records what the next turn needs, so the agent does not re-derive what it already found. */
  remember(note: Omit<EpisodicNote, "at">): void;
}

/** A precondition checked before `execute`. Its reason goes back to the model as an observation. */
export interface Guard<I> {
  name: string;
  check(input: I, ctx: SkillContext): Promise<GuardVerdict> | GuardVerdict;
}

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

export type SkillResult =
  | { status: "ok"; data: unknown; summaryForModel: string }
  | { status: "failed"; error: string }
  /** The skill needs something from the customer first — the model asks, the turn continues. */
  | { status: "needs_input"; ask: string }
  /** A guard rejected the call. Distinct from `failed` so evals can assert on intent, not errors. */
  | { status: "blocked"; reason: string }
  /** Terminal: the conversation belongs to a human now. */
  | { status: "handover"; reason: string };

/** A guard and the calls it applies to. See architecture.md#guards. */
export interface ScopedGuard<I> {
  guard: Guard<I>;
  appliesWhen(input: I): boolean;
}

export interface Skill<I = unknown> {
  name: string;
  /** The description the model sees when deciding whether to call this skill. */
  description: string;
  /** Tool arguments are untrusted JSON, so the input side is `unknown`. */
  schema: z.ZodType<I, z.ZodTypeDef, unknown>;
  guards?: Array<Guard<I> | ScopedGuard<I>>;
  execute(input: I, ctx: SkillContext): Promise<SkillResult>;
  /** Injected into the system prompt. Behaviour lives in versioned markdown, not in literals. */
  proceduralDoc?: string;
}
