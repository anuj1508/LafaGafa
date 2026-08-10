---
name: trace-event
description: Add a new trace event type end to end. Use when the harness gains a decision or a step that a reviewer would need to see in order to explain a reply.
---

# Adding a trace event

## The test for whether it belongs

Transparency has one bar: a reviewer answers _"why did the agent say that?"_ in under a minute,
from the trace alone. If a step influenced the reply and is not in the trace, the trace is wrong.
If a step is pure bookkeeping and nobody would ask about it, adding an event is noise.

## The path, in order

1. **`packages/core/src/tracing/events.ts`** — add the interface and extend the `TraceEvent`
   union. Include `latencyMs` for anything that takes measurable time, and include the _inputs
   that drove the decision_, not just its outcome. An event saying `decision: "skip"` with no
   reason is unfalsifiable and therefore useless.
2. **Export it** from `packages/core/src/index.ts`.
3. **Emit it** at the point of decision, not afterwards from reconstructed state.
4. **Persistence** — the Postgres sink stores the discriminant in its own column and the rest as
   `payload`, so a new type needs no migration. Confirm any field you plan to aggregate or filter
   on (latency, provider, decision) is queryable rather than buried in JSON.
5. **Assertions** — if the event encodes a behavior worth guaranteeing, add a deterministic eval
   that reads it. Events nobody asserts on tend to quietly stop being emitted.

## Rules

- Payloads carry the real content, not summaries. The assembled prompt means the assembled
  prompt.
- Never log a token, an API key, or a raw OAuth payload into an event.
- Ordering comes from `seq`, never from `ts` — sub-millisecond events are routine.
