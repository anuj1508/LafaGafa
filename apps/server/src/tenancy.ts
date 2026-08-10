import { schema, type Database } from "@harness/db";
import { eq } from "drizzle-orm";

/**
 * Resolves a CRM location id to our own sub-account id, once, at the edge — the only place a GHL
 * identifier becomes a lookup. Cached; a burst would otherwise query per message. See #tenancy.
 */
const cache = new Map<string, string>();

export async function subAccountIdFor(
  db: Database,
  ghlLocationId: string,
  name: string,
): Promise<string> {
  const hit = cache.get(ghlLocationId);
  if (hit !== undefined) return hit;

  const existing = await db
    .select({ id: schema.subAccounts.id })
    .from(schema.subAccounts)
    .where(eq(schema.subAccounts.ghlLocationId, ghlLocationId))
    .limit(1);

  const found = existing[0]?.id;
  if (found !== undefined) {
    cache.set(ghlLocationId, found);
    return found;
  }

  // Self-provisioning: a location that sends us a webhook is a customer, whether or not anyone
  // clicked through onboarding first. Better than dropping the trace on the floor.
  const created = await db
    .insert(schema.subAccounts)
    .values({ name, ghlLocationId })
    .onConflictDoNothing()
    .returning({ id: schema.subAccounts.id });

  const id = created[0]?.id;
  if (id !== undefined) {
    cache.set(ghlLocationId, id);
    return id;
  }

  // Lost the race with a concurrent webhook; the row exists now.
  const raced = await db
    .select({ id: schema.subAccounts.id })
    .from(schema.subAccounts)
    .where(eq(schema.subAccounts.ghlLocationId, ghlLocationId))
    .limit(1);
  const winner = raced[0]?.id ?? "";
  if (winner !== "") cache.set(ghlLocationId, winner);
  return winner;
}
