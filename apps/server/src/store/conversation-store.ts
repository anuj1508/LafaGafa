import { schema, type Database } from "@harness/db";
import type { EpisodicNote } from "@harness/core";
import { and, eq, sql } from "drizzle-orm";

interface ConversationState {
  id: string;
  aiEnabled: boolean;
  repliesSent: number;
  consecutiveFailures: number;
}

/**
 * Per-conversation agent state. `aiEnabled` is the kill switch every inbound message is checked
 * against before a turn is ever queued, so a handover silences the agent even if the steps after
 * it failed.
 */
/** Bounded so a long conversation cannot grow the prompt without limit. Oldest notes drop first. */
const MAX_NOTES = 12;

export class ConversationStore {
  constructor(private readonly db: Database) {}

  /** Records the conversation if it is new and returns its current state either way. */
  async upsert(input: {
    locationId: string;
    ghlConversationId: string;
    contactId: string;
  }): Promise<ConversationState> {
    const [row] = await this.db
      .insert(schema.conversations)
      .values(input)
      .onConflictDoUpdate({
        target: [schema.conversations.locationId, schema.conversations.ghlConversationId],
        // A no-op update rather than DoNothing: DoNothing returns no row on conflict, and the
        // caller needs the existing state to decide whether the agent is still answering.
        set: { updatedAt: new Date() },
      })
      .returning({
        id: schema.conversations.id,
        aiEnabled: schema.conversations.aiEnabled,
        repliesSent: schema.conversations.repliesSent,
        consecutiveFailures: schema.conversations.consecutiveFailures,
      });

    if (!row) throw new Error(`Failed to upsert conversation ${input.ghlConversationId}`);
    return row;
  }

  /** Silences the agent for one conversation. The kill switch behind human_handover. */
  async setAiEnabled(input: {
    locationId: string;
    ghlConversationId: string;
    enabled: boolean;
    reason?: string;
  }): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({
        aiEnabled: input.enabled,
        handoverReason: input.reason ?? null,
        handoverAt: input.enabled ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversations.locationId, input.locationId),
          eq(schema.conversations.ghlConversationId, input.ghlConversationId),
        ),
      );
  }

  /**
   * What the agent did and learned on earlier turns, oldest first.
   *
   * Anything older than the operator's window is dropped rather than returned stale: a note from
   * three days ago is noise in every prompt, and a conversation resumed a week later should start
   * from what the customer says now, not from what the agent was in the middle of doing then.
   */
  async memory(
    locationId: string,
    ghlConversationId: string,
    maxAgeHours?: number,
  ): Promise<EpisodicNote[]> {
    const [row] = await this.db
      .select({ memory: schema.conversations.memory })
      .from(schema.conversations)
      .where(
        and(
          eq(schema.conversations.locationId, locationId),
          eq(schema.conversations.ghlConversationId, ghlConversationId),
        ),
      )
      .limit(1);

    const notes = Array.isArray(row?.memory) ? (row.memory as EpisodicNote[]) : [];
    if (maxAgeHours === undefined) return notes;

    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    return notes.filter((note) => new Date(note.at).getTime() >= cutoff);
  }

  async appendMemory(
    locationId: string,
    ghlConversationId: string,
    notes: EpisodicNote[],
  ): Promise<void> {
    if (notes.length === 0) return;
    const existing = await this.memory(locationId, ghlConversationId);
    await this.db
      .update(schema.conversations)
      .set({ memory: [...existing, ...notes].slice(-MAX_NOTES), updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversations.locationId, locationId),
          eq(schema.conversations.ghlConversationId, ghlConversationId),
        ),
      );
  }

  /**
   * Records how the turn went and returns the running failure count.
   *
   * Reset on success rather than decremented: three failures spread over a long, otherwise
   * healthy conversation is not the same as three in a row, and only the latter means the agent
   * is stuck.
   */
  async recordTurnOutcome(
    locationId: string,
    ghlConversationId: string,
    failed: boolean,
  ): Promise<number> {
    const [row] = await this.db
      .update(schema.conversations)
      .set({
        consecutiveFailures: failed ? sql`${schema.conversations.consecutiveFailures} + 1` : sql`0`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversations.locationId, locationId),
          eq(schema.conversations.ghlConversationId, ghlConversationId),
        ),
      )
      .returning({ consecutiveFailures: schema.conversations.consecutiveFailures });

    return row?.consecutiveFailures ?? 0;
  }

  async countReply(locationId: string, ghlConversationId: string): Promise<void> {
    await this.db
      .update(schema.conversations)
      .set({ repliesSent: sql`${schema.conversations.repliesSent} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversations.locationId, locationId),
          eq(schema.conversations.ghlConversationId, ghlConversationId),
        ),
      );
  }
}
