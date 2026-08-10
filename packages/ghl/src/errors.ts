/**
 * The error taxonomy callers branch on. Deliberately coarse: one variant per recovery strategy,
 * so a new endpoint never needs a new branch at the call site.
 */
export type GhlErrorKind = "auth" | "rate_limit" | "invalid" | "not_found" | "upstream";

export class GhlApiError extends Error {
  constructor(
    readonly kind: GhlErrorKind,
    readonly status: number,
    message: string,
    readonly body?: unknown,
    options?: { cause?: unknown },
  ) {
    // The response body carries the only useful part of a GHL rejection — which field it did not
    // like. Keeping it out of `message` means every log line says "failed with 400" and the
    // reason has to be reproduced by hand.
    super(body === undefined ? message : `${message}: ${summarise(body)}`, options);
    this.name = "GhlApiError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limit" || this.kind === "upstream";
  }
}

/** Bounded so a stray HTML error page cannot flood the logs. */
function summarise(body: unknown): string {
  let text: string;
  try {
    text = typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    // A circular structure throws. Nothing here is worth failing an error path over.
    return "<unserialisable body>";
  }
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

export function classifyStatus(status: number): GhlErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 404) return "not_found";
  if (status >= 500) return "upstream";
  return "invalid";
}
