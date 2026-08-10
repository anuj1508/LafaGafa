import type { ConnectionOptions } from "node:tls";

/**
 * Whether a connection string needs TLS, decided from the host rather than a flag someone forgets.
 * Verification is relaxed without `PGSSLROOTCERT`: safe from eavesdropping, not from an active
 * man-in-the-middle. Supply the CA in production.
 */
export function sslFor(connectionString: string, ca?: string): ConnectionOptions | false {
  const host = new URL(connectionString).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
}
