# Architecture

How the monorepo is laid out, what each module owns, and the reasoning behind choices the code
cannot state in two lines. Anchors in the decisions section are referenced from source comments.

For setup and what the project is, see [README.md](../README.md). For measured results, see
[eval-results.md](eval-results.md).

## Packages

| Package               | Owns                                                    | May import              |
| --------------------- | ------------------------------------------------------- | ----------------------- |
| `packages/core`       | the loop, tracing, RAG + gate, skill contracts          | `config` only           |
| `packages/ghl`        | typed CRM client, OAuth lifecycle, SSO, webhook schemas | `config` only           |
| `packages/skills-ghl` | the three skills and their guards                       | `core`, `ghl`, `config` |
| `packages/config`     | zod schemas for env and settings                        | nothing                 |
| `packages/db`         | Drizzle schema, migration, pool                         | nothing                 |
| `apps/server`         | Express: webhooks, OAuth, SSO, queue, workers           | any package             |
| `apps/admin`          | operator product and internal console                   | any package             |
| `apps/chat`           | the practice website and chat widget                    | any package             |
| `evals/`              | four suites and their fixtures                          | any package             |

`packages/core` imports nothing GoHighLevel. That is enforced by ESLint `boundaries/element-types`
for relative paths and `boundaries/external` for bare specifiers, not by convention. Apps never
import each other.

Lint runs once from the repo root and must stay that way. The boundary element patterns are
relative to the working directory, so a per-package invocation matches nothing and every
architectural rule stops firing while still reporting success.

## Module to path

| Module                    | Path                                                      |
| ------------------------- | --------------------------------------------------------- |
| Webhook receiver          | `apps/server/src/routes/webhooks.ts`                      |
| Queue + debouncer         | `apps/server/src/queue/`                                  |
| Kill switch               | `conversations.ai_enabled` in `packages/db/src/schema.ts` |
| Turn orchestration        | `apps/server/src/worker.ts`, `apps/server/src/turn/`      |
| Session and prompt        | `packages/core/src/loop/session.ts`                       |
| The loop                  | `packages/core/src/loop/agent.ts`                         |
| Tool dispatch and guards  | `packages/core/src/loop/tools.ts`                         |
| Retrieval gate            | `packages/core/src/rag/gate.ts`                           |
| Chunk, embed, retrieve    | `packages/core/src/rag/`                                  |
| Provider chain + failover | `packages/core/src/providers/`                            |
| Tracer                    | `packages/core/src/tracing/tracer.ts`                     |
| Trace event model         | `packages/core/src/tracing/events.ts`                     |
| Skill + guard contracts   | `packages/core/src/skills/`                               |
| The three skills          | `packages/skills-ghl/src/`                                |
| GHL client                | `packages/ghl/src/client.ts`                              |
| Settings + env schemas    | `packages/config/src/`                                    |
| Database schema           | `packages/db/src/schema.ts`                               |
| Knowledge store           | `apps/server/src/store/knowledge-store.ts`                |
| Release gate              | `scripts/gate.ts`                                         |

## Three kinds of memory

The harness separates memory by what the thing is, not by where it is stored.

| Kind           | Holds                              | Implementation                                                      |
| -------------- | ---------------------------------- | ------------------------------------------------------------------- |
| **Semantic**   | what is true generally             | `kb_chunks` in pgvector, reached only when the gate says so         |
| **Episodic**   | what this conversation established | `conversations.memory`, typed as `EpisodicNote`, staleness per note |
| **Procedural** | how to behave                      | `SOUL.md` and `skills/*/SKILL.md`, injected into the system prompt  |

Semantic memory is retrieved, never assumed: an answer with no passage above the relevance floor
becomes a refusal. Episodic memory is what makes "the 9am one please" resolvable three turns after
the slots were offered. Procedural memory is versioned markdown rather than code, on one rule: if
the model getting it wrong would be a bug it belongs in code, and if it would be a bad judgement
call it belongs in markdown.

## Extending it

### Adding a fourth provider

One entry in `settings.yaml` and one key in `.env`. No code changes.

```yaml
model:
  chain:
    - provider: mistral
      model: mistral-large-latest
      temperature: 0.3
      maxOutputTokens: 1200
      timeoutMs: 15000
```

`ProviderRegistry` in `packages/core/src/providers/registry.ts` resolves a binding to a callable
model, and `callModel` normalises tool calls, streaming and error semantics across all of them. A
provider with no key is filtered out of the chain at call time rather than throwing, so a missing
key degrades to failover instead of an outage. Adding the vendor to `providerNameSchema` in
`packages/config/src/settings.ts` is the only source edit, and it is one line in an enum.

### Adding a third skill

One directory, one registry line, one markdown file, and eval cases.

```
packages/skills-ghl/src/cancel-appointment/
  index.ts      the Skill: zod input schema, execute, guards
  guards.ts     preconditions that block the call and return a reason
skills/cancel_appointment/SKILL.md   behavioural instructions, injected into the prompt
```

Then one line in `packages/skills-ghl/src/index.ts` to register it, one flag in `settings.yaml`
under `skills:`, and cases in `evals/fixtures/behaviour.yaml` including the negative ones. Nothing
in `packages/core` changes: `SkillRegistry` is the whole integration surface, and the loop
discovers tools from it.

---

# Design decisions

Code comments say what is true now. This says why it was chosen and what it cost.

## The loop

### Every exit produces words {#loop-exits}

`runTurn` has three ways out: the model stops asking for tools, the iteration cap trips, or the
wall-clock budget runs out. All three end in a reply.

A webhook agent cannot spin, and silence reads to a customer as a broken bot. Worse, the two
guardrail exits are exactly the turns where something half-happened — so the reply matters most
there. An early version returned `settings.safety.fallbackMessage` on both, which meant the agent
said "I'll get a colleague to help" immediately after successfully booking an appointment. That is
the worst outcome available: the action happened, the customer was told it did not.

So both guardrail exits call `speak()` — one more model call with no tools offered. The model has
already done the work and holds every observation; what it lacks is a turn in which to say so. The
canned message survives only as the fallback if that call itself fails.

### Handover is terminal {#handover-terminal}

Once a skill returns `handover`, the loop returns immediately with the configured final message.
The conversation belongs to a person now, and an agent that keeps reasoning about it is how a
customer ends up talked over by software while a human is typing.

### The acknowledgement is the model's own words {#interim-reply}

`onInterimReply` fires only when the model writes something before its tool calls. A canned holding
line is worse than none: "let me check that for you" is wrong when the customer just said "yes,
book it". Models narrate before acting anyway, so the acknowledgement is theirs to write — it fits
the moment and costs no extra call.

### `hasPendingAction` is deliberately narrow {#pending-action}

Only short messages with no question mark, and only when there is recent episodic context.
Mid-booking, "9:30 works" is a reply and searching for it wastes a round trip — but "what are your
opening hours?" mid-booking is still a real question. Missing context the customer needed is a
worse failure than one unnecessary search, so the heuristic errs towards searching.

---

## Retrieval

### Two stages, cheapest first {#retrieval-gate}

A free regex catches openers and mid-action replies. Everything else goes to a small model, which
also rewrites the message into something a vector search can match — "do you guys do refunds tho"
and "refund policy" are not close in embedding space, so the rewrite is doing real work rather than
tidying.

The gate has no failover chain and fails **open**: on timeout it retrieves. A false skip is a wrong
answer to the customer; a false retrieve costs latency only. The eval floors say the same thing —
recall 95%, precision 85%.

### One query per question {#multi-query}

`GateDecision.queries` is a list. A single rewrite silently dropped half of any two-part question:
"what time do you close on friday and how much is a check-up?" became "Friday closing time", `fees.md`
was never a candidate, and the agent declined a price it holds. That decline read as honest caution,
which is the worst shape this bug can take. Retrieval now searches each query and merges by best
score.

### A table row is a passage {#table-chunking}

Markdown tables are chunked per row and headed — `Fees — Routine check-up: £55`. Left whole, a
thirteen-row fee table embeds as one vector averaged across every treatment, VAT and payment terms,
and loses to any prose page that merely mentions a price. Measured: asked for a check-up price,
`fees.md` did not make the top four while `x-rays.md` did. Per row, it ranks first at 0.602.

Generally: anything the author formatted as a table is a list of separate facts, and embedding it as
one passage discards the structure that made it a table.

---

## Providers

### The chain is the retry strategy {#failover}

`maxRetries: 0` on every call, with failover to the next chain entry instead. The SDK's own retries
would trip each vendor three times before switching, tripling the latency of an outage and hiding
the attempts from the trace.

Worth failing over: timeouts, 429, 5xx, an exhausted balance, and a model the vendor has retired.
The last two arrive as 400 and 404 — statuses that are permanent for _that entry_ and wrong about
the chain, because the next entry is a different vendor with a different model. Not worth failing
over: a malformed request or a bad key, which every provider rejects identically.

### Reasoning at the floor, on every role {#thinking}

Gemini 3.x thinks before it writes and spends the output budget doing it. At 60 tokens the gate
truncated mid-JSON, every call failed open, and the result read as a model that retrieves on
everything rather than one that never answered. The gate decides a boolean and the judge scores a
rubric; neither improves with deliberation and both pay for it on every turn.

Chat was left thinking until latency was measured properly, and then it stopped being defensible: a
gate call at `low` cost 1291 ms of a 2964 ms turn — longer than the chat call it was gating. None of
the three roles is a reasoning problem. A front-desk reply that needs deliberation is a reply that
needed a person.

Note the field is `thinkingLevel`, not `thinkingBudget` — 3.x rejects the older one outright, and
`minimal` is the lowest the 4.x SDK exposes. It is a constant rather than a setting because there is
no operator answer to "how much should it think" that is not just "as little as it can".

---

## Skills

### Guards, not prompt instructions {#guards}

"Must NOT fire" is a precondition that blocks the call and returns its reason to the model as an
observation. A sentence in a prompt is a hope; a guard is a test.

Guards declare their scope with `appliesWhen`, so `contact_is_identified` applies to booking and not
to checking availability. Demanding a phone number before answering "what's free Tuesday?" turns the
agent into a form gate in front of a question it could simply have answered.

### Record what nothing can act on; act on what something can {#record-vs-act}

"Mornings work best for me" has an action — search the mornings — so it is not written down.
A third party's email has no action that uses it, so it is. This settled a case that had three
different expectations across the project.

`preferredTime` and `budget` were removed from the writable allowlist: neither is a real GoHighLevel
field, so both silently became notes nobody reads while the agent told the customer it had saved
something. Anything outside the four standard contact fields is written as a note, which is a real
endpoint needing no extra scope.

### Everything computable reaches the model already computed {#precomputed}

Slots arrive as `Tue 11 Aug, 09:00 am [2026-08-11T08:00:00.000Z]`. The model says the words and
copies the identifier back to book with; it never converts anything. It was reading `08:00Z` as
"8:00 AM" and offering a London customer an hour that did not exist in their day, and no prompt
wording fixes that — converting instants is what language models are unreliable at.

---

## Tracing

### `seq`, not timestamps {#trace-order}

Sub-millisecond events are routine and a trace whose order is ambiguous cannot answer "what did it
do first?". The tracer assigns a monotonic sequence per turn.

### Our tenancy, never the vendor's {#tenancy}

`sub_accounts` maps our uuid to a GoHighLevel location and is the only place a vendor identifier
appears. Everything downstream keys on our id, which makes a CRM migration a row update rather than
a rewrite of every trace ever stored. `trace_events` carries `sub_account_id` directly rather than
joining through `conversations`, because eval turns have no conversation row at all.

---

## Evals

### Four suites, four questions {#eval-suites}

See [eval-results.md](eval-results.md) for what each suite asks and the measured numbers.

### The fixture is as likely to be wrong as the agent {#fixture-review}

Five times in this project a case failed and the expectation was wrong, not the behaviour. Each
arrived disguised as a bug report. `pnpm eval:review` asks a model to argue the opposite side of
each expectation and prints only the disagreements; it never fails the build, because a model's
opinion on what a receptionist should do is not authoritative. Roughly one flag in fifteen is real.

### Eval turns persist {#eval-traces}

They write to the same `trace_events` table tagged `source: "eval"`, and each result carries its
`turnId`. A failing case is then a turn you can replay through the pipeline rather than a line of
text.

### Episodic, not semantic {#memory}

Session memory carries what _this conversation_ established — "you offered 8:00 and 9:30", "the
thinning is at the crown and minoxidil did nothing". Semantic facts (the knowledge base, a
customer's email) live in the CRM and the index. Staleness is a common attribute of an episodic
note, not its definition: some decay because the world moved on, others stay true for as long as
the conversation does and are exactly what a colleague needs at handover.

## The edge

### One reply per burst, one turn per conversation {#queue}

Two guarantees, both noticed only when missing. Someone sending four texts in ten seconds gets one
coherent answer, not four overlapping ones — the debounce window resets on each message, so the
batch closes once they stop typing. And turns for the same conversation run in sequence, so a
second batch never reads history a first turn has not finished writing.

Kept in memory. A restart drops pending batches and in-flight turns, and two instances would each
debounce their own share of a burst. Both acceptable for a single-instance deployment, neither
hidden by the interface.

### Two clocks, and only one of them is the SLO {#slo-clock}

`turn_end.totalLatencyMs` measures the loop: gate, retrieval, model, skills. It starts when
`runTurn` is entered and is the number a provider comparison wants, because it contains nothing but
our own work and the vendor's.

The target is written about something larger — webhook received to reply accepted by the CRM — so
`turn_sent` carries that separately, along with how much of it the CRM itself took. Reporting only
the loop would flatter the harness by leaving out the queue, the history fetch and the send; those
are real time a customer waits. Debounce is deliberately inside the number: the clock starts at the
earliest message of a batch, which is when the customer stopped being answered.

`turn_sent` therefore carries its own arithmetic: `queuedMs` (waiting, not working), `loopMs`,
`crmMs` and `sendMs`. The first measurement showed why that matters — a turn whose loop took 2417 ms
kept the customer waiting 7265 ms, and 4000 ms of the gap was the debounce window rather than
anything slow. A total nobody can decompose invites exactly the wrong fix. The default is now
1000 ms, overridable with `DEBOUNCE_MS` because a deployment's settings file can be a read-only
secret mount.

`crm_call` is what makes the difference legible. It is emitted from an axios interceptor in
`packages/ghl`, which may not import `core`, so the client takes a plain `onCall` callback and the
edge turns it into a trace event. The active turn is found through an `AsyncLocalStorage` rather
than threaded through every endpoint signature: one shared client serves every turn, and a
module-level variable would bill a round trip to whichever turn started most recently.

### The chat surface is reached directly, not proxied {#cors}

In development the Vite proxy puts the chat app and the server on one origin, so `/api` is a
same-origin path and nothing needs CORS. A deployment that serves the app as static files from a
CDN cannot repeat the trick: the CDN's rewrite buffers a response until it completes, and the SSE
reply stream never completes, so the widget receives nothing at all while the server has already
written the reply. Measured against Render's rewrite: zero bytes in twenty seconds, no headers.

So the deployed widget calls the server's own origin, `VITE_API_BASE` at build time, and the server
answers cross-origin requests from an allowlist in `CORS_ALLOWED_ORIGINS`. The allowlist is
environment rather than settings because it is deployment wiring, like `PORT`. No credentials mode:
the session id travels in the query string and there are no cookies. An empty allowlist disables
the middleware entirely, which is what dev and the tests run with.

The admin console has no streaming endpoint, so a CDN rewrite serves it correctly and it stays on
one.

## The console

### Scope is a place, not a filter {#scope-is-a-place}

You do not filter to Northwind Dental, you go there, and everything you look at next is already
there. So scope holds names alongside ids (a breadcrumb must read without a second lookup) and
survives navigation — narrowing to a customer and then opening Quality must show that customer's
quality, or the narrowing was theatre. The rejected alternative is a row of selects spending four
widths saying "All / All / All", which is a filter panel bolted to a report.

The same idea shapes the sidebar: step into a sub-account and the sidebar _becomes_ its sections,
rather than a second vertical rail appearing inside the page to compete with it. Agents and
knowledge are never organisation-level things.

### Two doors, not one login with a role {#two-doors}

Customers sign in at `#/signin` and see their own organisation. LafaGafa staff sign in at
`#/admin`, a separate route with a separate form, and see the whole platform. One login with a role
dropdown puts the entire customer base one mis-click from a support rep. It is mocked, and does not
pretend otherwise: a role the browser can choose is not a role.

### The trace is a decision log, not a transcript {#decision-trace}

GoHighLevel is the system of record and the team already reads that inbox. Mirroring conversations
here gives two copies that drift the moment a human replies in the CRM, and makes this a second
store of patients' messages — doubling the blast radius of a breach to duplicate something the CRM
does better. What only this product knows is _why_: what was retrieved, that nothing cleared the
floor, which rule fired, which skill ran.

The one concession is the reply text on turns that went wrong. Judging "it answered badly" without
seeing the claim is impossible, and a rule that produced no useful screen would be principle for
its own sake.

### The product shape is fixtures {#tenancy-shape}

The harness runs one location from `settings.yaml`. Organisations, sub-accounts, agents, plans and
the config-change audit are the shape it would take as a product, kept in `apps/admin/src/mock/`
and labelled in the UI. The trace pages next door read the real database and the difference has to
stay obvious.

One structural idea is worth stating: a sub-account is defined by its **knowledge base**, not by
its website. A website is only the most convenient way to seed one — which is why a sub-account can
exist before a URL is entered, and why an agent can carry a second, narrower knowledge base of its
own.

### Idle connections are kept {#connection-pool}

node-pg closes idle connections after 10s by default. Opening a new one against a managed Postgres
costs ~3.5s — TCP, TLS 1.3 and SCRAM is about six round trips before a byte of SQL, and the round
trip alone measured 377ms.

Retrieval issues one query per question, so a two-part question needs two connections. Any
conversation with more than ten seconds between messages found an empty pool and paid the handshake
mid-turn: 4.4s of a 6.2s retrieval, while `EXPLAIN ANALYZE` reported 0ms execution and 0ms planning
over an HNSW index. The database was never the cost.

Measured, same two-query shape: 6163ms before, 2351ms after. Warm, two parallel vector queries cost
~900ms and four cost ~629ms.

The wrong answers this ruled out, both plausible and both measurable: the pgvector search being
slow, and the 29.5KB embedding literal saturating the uplink. Shipping two of those payloads in
parallel costs 335ms.

### `--keep-going` {#keep-going}

The gate stops at the first failed stage on purpose — later numbers would measure a build already
known to be broken. But a run whose job is to _produce_ a full set of numbers needs the opposite: a
judge stage that misses its floor must not cost the latency figures that come after it. The exit
code stays non-zero, so the flag changes what runs, never what passes.
