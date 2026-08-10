import { schema, type Database } from "@harness/db";

/**
 * Webhook idempotency.
 *
 * GHL redelivers, and a redelivery must not produce a second reply to the customer. The check is
 * an insert rather than a read-then-write because two concurrent deliveries of the same message
 * would both pass a read: the unique index on `message_id` is what actually decides, and only the
 * insert that wins it returns a row.
 */
export class ProcessedMessageLog {
  constructor(private readonly db: Database) {}

  /** True when this process is the first to claim the message, false for a redelivery. */
  async claim(messageId: string, locationId: string): Promise<boolean> {
    const claimed = await this.db
      .insert(schema.processedMessages)
      .values({ messageId, locationId })
      .onConflictDoNothing()
      .returning({ messageId: schema.processedMessages.messageId });

    return claimed.length > 0;
  }
}
