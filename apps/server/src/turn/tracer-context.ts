import { AsyncLocalStorage } from "node:async_hooks";
import type { Tracer } from "@harness/core";

/**
 * The tracer belonging to the turn currently running on this async stack.
 *
 * The GHL client is built once per process and shared, but a CRM round trip belongs to one turn.
 * Threading a tracer through every API signature would touch every endpoint for one field, and a
 * module-level variable would attribute calls to whichever turn happened to start last.
 */
const storage = new AsyncLocalStorage<Tracer>();

/** Runs `fn` with `tracer` as the ambient one. Everything it awaits inherits it. */
export function withTracer<T>(tracer: Tracer, fn: () => Promise<T>): Promise<T> {
  return storage.run(tracer, fn);
}

/** Undefined outside a turn — OAuth callbacks and the chat session route have no turn to blame. */
export function currentTracer(): Tracer | undefined {
  return storage.getStore();
}
