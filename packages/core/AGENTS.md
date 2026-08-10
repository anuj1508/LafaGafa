# packages/core

The harness. This package is the architectural claim being graded, so it carries stricter rules
than the rest of the repo.

- **No GoHighLevel.** No import from `@harness/ghl`, no GHL vocabulary in type names, no CRM
  concepts in the loop. If `core` needs something from the CRM, it takes it as an argument or
  behind an interface the caller implements. ESLint enforces the import direction; the naming is
  on you.
- **The loop stays readable.** `src/loop/agent.ts` stays under ~120 lines and stays a plain
  `for` loop over reason → act → observe. No state machine, no framework, no clever indirection.
  A reviewer must be able to read it once and know what happens.
- **Every branch emits a trace event.** Gate decisions, retrievals, model calls, failovers, guard
  verdicts, tool results, and the reason the loop stopped. Add the event type to
  `src/tracing/events.ts` before the code that emits it.
- **Two exits, always.** Iteration cap and wall-clock budget. Neither may be removed, and neither
  may throw — both end the turn with a graceful reply.
- Providers are resolved by role (`chat`, `gate`, `judge`) from settings. Nothing in this package
  names a vendor outside `src/providers/`.
