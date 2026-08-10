import type { Settings } from "@harness/config";
import type { ModelMessage } from "ai";
import { formatContext } from "../rag/retrieve.js";
import { formatInZone } from "../time.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { KnowledgeStore, RetrievedChunk } from "../rag/retrieve.js";
import type { EpisodicNote } from "../skills/types.js";

export interface TurnInput {
  locationId: string;
  contactId: string;
  conversationId: string;
  /** The debounced customer message(s) this turn answers. */
  text: string;
  /** Prior turns, oldest first. */
  history: ModelMessage[];
}

export interface Session {
  input: TurnInput;
  /**
   * What the CRM already holds. Without it the model re-saves every detail visible in the history
   * on every turn, because nothing tells it that "I'm Anuj Gupta" landed hours ago.
   */
  knownContact?: Record<string, string>;
  /** The agent's character, read from SOUL.md. Placeholders are substituted at assembly time. */
  soul?: string;
  /** The business's own documents. Absent means this location has no knowledge base. */
  knowledge?: KnowledgeStore;
  /** What happened on earlier turns of this conversation, oldest first. */
  episodic?: EpisodicNote[];
  /** Set once the gate has run and retrieval was attempted. Absent means it was skipped. */
  retrieved?: { chunks: RetrievedChunk[] };
  /** Injected so a test can assert on a fixed date rather than on whatever today happens to be. */
  now?: Date;
  settings: Settings;
  skills: SkillRegistry;
  /** Behavioural docs for the enabled skills, already read from disk. */
  proceduralDocs: string[];
}

/**
 * The instructions the model runs under.
 *
 * Assembled from settings and the enabled skills' own docs rather than written as a literal, so
 * changing how the agent behaves is editing markdown or a settings value — not editing the loop.
 */
/**
 * The instructions the model runs under.
 *
 * The agent's character lives in SOUL.md, not here: it is prose, an operator revises it far more
 * often than anyone touches this file, and a behavioural change should not need a deploy. This
 * function only substitutes what SOUL.md cannot know — the clock, the business, and what the
 * agent has learned in this particular conversation.
 */
export function buildSystemPrompt(session: Session): string {
  const { settings } = session;
  const now = session.now ?? new Date();

  const parts = [
    render(session.soul ?? MINIMAL_SOUL, {
      businessName: settings.businessName,
      now: formatNow(now, settings.timezone),
      timezone: settings.timezone,
      declineMessage: settings.safety.declineMessage,
    }),
  ];

  if (settings.behavior.bannedPhrases.length > 0) {
    parts.push(`Never use these words or phrases: ${settings.behavior.bannedPhrases.join(", ")}.`);
  }

  const known = Object.entries(session.knownContact ?? {}).filter(([, value]) => value.length > 0);
  if (known.length > 0) {
    parts.push(
      `Already on file for this customer: ${known.map(([field, value]) => `${field} = ${value}`).join(", ")}.`,
    );
  }

  const episodic = session.episodic ?? [];
  const fresh = episodic.filter((note) => !hasGoneStale(note, now));
  const stale = episodic.filter((note) => hasGoneStale(note, now));

  // Only the facts and their age are stated here. What to do about a stale one is a judgement
  // call and lives in the relevant skill's own doc, where an operator can change it without a
  // deploy — the harness's job is to be right about which bucket a note is in, not to decide
  // how the agent should feel about that.
  if (fresh.length > 0) {
    parts.push(
      "Earlier in this conversation, and still true:\n" +
        fresh.map((note) => `- ${formatWhen(note.at, now)}: ${note.detail}`).join("\n"),
    );
  }
  if (stale.length > 0) {
    parts.push(
      "Also earlier, but old enough that it may have changed:\n" +
        stale.map((note) => `- ${formatWhen(note.at, now)}: ${note.detail}`).join("\n"),
    );
  }

  if (session.retrieved) {
    parts.push(
      session.retrieved.chunks.length > 0
        ? formatContext(session.retrieved.chunks)
        : // Said explicitly rather than left as an absence. A model given no context and no
          // explanation fills the silence from its own general knowledge, which is exactly the
          // fabrication the relevance floor exists to prevent.
          "You searched the business's documents and nothing relevant came back. You do not know " +
            "the answer to this. Say so and offer to pass it to the team. Do not answer from " +
            "general knowledge about this kind of business.",
    );
  }

  if (session.proceduralDocs.length > 0) {
    parts.push(
      "Instructions for the actions you can take:\n\n" + session.proceduralDocs.join("\n\n"),
    );
  }

  return parts.join("\n\n");
}

/** Used only when no SOUL.md was supplied, as in a unit test that is not about the prose. */
const MINIMAL_SOUL =
  "You are the assistant for {{businessName}}. It is {{now}} in {{timezone}}. Be brief and " +
  'plain. If you cannot answer, say: "{{declineMessage}}"';

/** `{{name}}` substitution. An unknown placeholder is left visible rather than silently blanked. */
function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Whether a note has outlived the freshness its own skill claimed for it. */
function hasGoneStale(note: EpisodicNote, now: Date): boolean {
  if (note.staleAfterMinutes === undefined) return false;
  return (now.getTime() - new Date(note.at).getTime()) / 60_000 > note.staleAfterMinutes;
}

/** Relative age, because "8 minutes ago" tells the model whether a fact is still safe to reuse. */
function formatWhen(at: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(at).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return "earlier";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/** A form the model can reason about: weekday, date, time, and the zone, without ambiguity. */
function formatNow(now: Date, timezone: string): string {
  const formatted = formatInZone(now, timezone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  // UTC is wrong but usable, and naming the bad zone puts the fix in front of whoever reads a trace.
  return (
    formatted ?? `${now.toISOString()} (UTC — "${timezone}" is not a timezone this system knows)`
  );
}

/**
 * The conversation as the model sees it.
 *
 * History is trimmed to a bounded window: the whole transcript would grow every turn's latency
 * and cost without improving the reply, since what matters is nearly always recent.
 */
export function buildMessages(session: Session, maxHistoryMessages = 20): ModelMessage[] {
  return [
    ...session.input.history.slice(-maxHistoryMessages),
    { role: "user", content: session.input.text },
  ];
}
