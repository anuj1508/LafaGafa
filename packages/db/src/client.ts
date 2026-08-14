import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import { sslFor } from "./ssl.js";

export type Database = NodePgDatabase<typeof schema>;

/**
 * A pooled connection over TCP. The pool matters for latency: the harness makes several small
 * reads while assembling a turn, and per-query connection setup would cost more than the queries.
 */
export function createDatabase(
  connectionString: string,
  options: { ca?: string; onIdleError?: (error: Error) => void } = {},
): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    // Kept, against node-pg's 10s default: reopening one costs ~3.5s. See #connection-pool.
    idleTimeoutMillis: 0,
    // Without it an idle TCP connection can be dropped by NAT and only discovered on next use.
    keepAlive: true,
    ssl: sslFor(connectionString, options.ca),
  });

  // Attached unconditionally: without a listener, an idle connection dying is an unhandled 'error'
  // event, which takes the whole process down. See #connection-pool.
  pool.on("error", (error) => options.onIdleError?.(error));

  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Opens `count` connections up front so no turn pays for one. Failures are ignored: a cold pool is
 * slow, not broken.
 */
export async function warmPool(pool: pg.Pool, count = 4): Promise<void> {
  await Promise.allSettled(Array.from({ length: count }, () => pool.query("select 1")));
}
