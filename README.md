# LafaGafa

A conversation AI agent for small businesses. A customer sends a message, the agent decides what
should happen: answer from the business's knowledge base, run a skill, or hand the conversation to a
person. It does it, replies in the same thread, and emits a complete trace of every step.

It runs on Claude, GPT and Gemini. Switching provider is a line in a config file.

The agent runs on a harness that knows nothing about any particular CRM. This build connects it to
**GoHighLevel**: inbound-message webhooks in, Conversations, Contacts and Calendars APIs out. That
integration is one package, `packages/ghl`, and `packages/core` is forbidden from importing it. The
demonstration business is Northwind Dental, a fictional practice with 19 documents in its knowledge
base.

| Document                                     | Contains                                                      |
| -------------------------------------------- | ------------------------------------------------------------- |
| This file                                    | what it is, how to set it up, how the work was owned          |
| [docs/architecture.md](docs/architecture.md) | monorepo layout, module map, design decisions and their costs |
| [docs/eval-results.md](docs/eval-results.md) | measured results per provider, with failure analysis          |

## The loop

```
webhook → dedupe → gate ──yes──▶ retrieval ⇄ knowledge base
                    │                  │
                    └──no──────────────┤
                                       ▼
                            loop( model ⇄ skills + guards )
                                       │
                              CRM send │ handover
                                       ▼
                                     trace
```

The **gate** is the piece the design rests on. Retrieving on every turn is slow and drags
irrelevant passages into the prompt, which biases the answer. So before the loop runs, a free regex
catches greetings and mid-action replies, and a small model decides the rest, rewriting the question
into something a vector search can match. 15 of 57 labelled turns never reach a model.

The **loop** has three exits: completed, max iterations, turn budget. Each produces words, because a
guardrail that returns silence is a customer left waiting.

## What you need

- **Node 24** and **pnpm 9**
- **Postgres 15+ with the pgvector extension**. Neon and Supabase both ship it. Locally,
  `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16`
- **API keys** for at least one of Anthropic, OpenAI or Google. OpenAI is needed regardless, because
  embeddings run on `text-embedding-3-small` for all three providers
- **A GoHighLevel sandbox** and a marketplace app, covered below
- **ngrok** or any tunnel, so GHL can reach your machine

## Setup

The order matters. Each step produces something the next one needs, and two of the values in
`settings.yaml` do not exist until the marketplace app does.

### 1. Clone and install

```bash
git clone <repo-url> && cd Itachi-AI
pnpm install
```

### 2. Start the tunnel

Do this first, because every URL you paste into HighLevel is built from it.

```bash
ngrok http 3000
```

Keep the URL. A free ngrok account gives a static domain, which is worth having: a URL that changes
on restart means editing three fields in HighLevel every time.

### 3. Create the HighLevel app

1. Create a developer account at [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com)
   and create a **sandbox sub-account** from the agency dashboard.
2. **My Apps, Create App.** Distribution type **Sub-Account**.
3. **Redirect URL:** `https://<your-tunnel>/oauth/callback`
4. **Scopes.** All of these:

   | Scope                            | Used for                           |
   | -------------------------------- | ---------------------------------- |
   | `contacts.readonly`              | reading the contact before a turn  |
   | `contacts.write`                 | `update_contact`, handover tagging |
   | `conversations.readonly`         | conversation history               |
   | `conversations.write`            | creating conversations             |
   | `conversations/message.readonly` | reading messages                   |
   | `conversations/message.write`    | sending the reply                  |
   | `calendars.readonly`             | listing calendars                  |
   | `calendars/events.readonly`      | free slot lookup                   |
   | `calendars/events.write`         | creating the appointment           |
   | `locations.readonly`             | resolving the sub-account          |

5. **Webhooks.** Both are needed:

   | Event             | URL                                  | Why                                                   |
   | ----------------- | ------------------------------------ | ----------------------------------------------------- |
   | `InboundMessage`  | `https://<your-tunnel>/webhooks/ghl` | the only thing that triggers the agent                |
   | `OutboundMessage` | `https://<your-tunnel>/webhooks/ghl` | how the harness notices a human replied and backs off |

6. **Conversation provider.** Add one of type SMS, delivery URL
   `https://<your-tunnel>/webhooks/ghl/provider-outbound`. This is what the agent's replies are sent
   through. **Copy its id.**
7. From the app's Settings page, copy the **client id**, **client secret** and **SSO key**.
8. From the sandbox sub-account, copy the **location id**.

### 4. Fill in the environment

```bash
cp .env.example .env
```

| Variable                       | Where it comes from                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                 | your Postgres connection string                                                               |
| `GHL_APP_CLIENT_ID`            | step 3.7                                                                                      |
| `GHL_APP_CLIENT_SECRET`        | step 3.7                                                                                      |
| `GHL_APP_SSO_KEY`              | step 3.7, used for embedded custom pages                                                      |
| `OPENAI_API_KEY`               | platform.openai.com. Required even if you run Claude or Gemini, because embeddings are OpenAI |
| `ANTHROPIC_API_KEY`            | console.anthropic.com                                                                         |
| `GOOGLE_GENERATIVE_AI_API_KEY` | aistudio.google.com                                                                           |
| `PORT`                         | defaults to 3000                                                                              |

### 5. Fill in the settings

```bash
cp settings.example.yaml settings.yaml
```

Two values come from step 3 and have no defaults:

- `locationId`, from step 3.8
- `ghl.conversationProviderId`, from step 3.6

`calendar.calendarId` can stay `null`, which uses the first active calendar. Everything else has a
working default. This file is where an operator changes the model chain, handover triggers, writable
contact fields, the relevance floor and timeouts, without touching code.

`settings.yaml` is read once at boot. Editing it needs a server restart, because `tsx watch` only
watches TypeScript.

### 6. Create the database schema

```bash
pnpm db:migrate
```

Eight tables, seventeen indexes and the pgvector extension, from the single migration in
`packages/db/migrations/`. Idempotent, so running it against an up-to-date database does nothing.

### 7. Start the server and install the app

```bash
pnpm dev
```

Then install the app onto your sandbox sub-account from the marketplace. The OAuth callback writes
the refresh token into `installations`, and **nothing works until this has happened**. There is no
way to skip it: every CRM call needs that token.

### 8. Index the knowledge base

```bash
pnpm kb:ingest
```

Reads every markdown file under `kb/`, chunks it, embeds it and replaces what is indexed. 19
documents become 80 chunks. This calls the OpenAI embeddings API and fails fast without
`OPENAI_API_KEY`, so step 4 has to be done first.

Until this runs, the agent answers every factual question with a refusal, which is correct behaviour
against an empty knowledge base and looks exactly like a bug.

### 9. Run the surfaces

```bash
pnpm dev                            # harness server        :3000
pnpm --filter @harness/chat dev     # practice website      :5175
pnpm --filter @harness/admin dev    # product and console   :5174
```

Open [localhost:5175](http://localhost:5175) and talk to the widget in the corner.

### 10. Check it works

```bash
pnpm verify                 # build, typecheck, unit tests, lint, dead code, formatting
pnpm gate --keep-going      # the full eval suite: gate, behaviour, judge, latency
pnpm trace                  # the turns you just created, as a waterfall
```

`pnpm gate --all-providers --keep-going` runs the suites against all three vendors and is what
produced [docs/eval-results.md](docs/eval-results.md).

### Why the chat widget goes through the CRM

The widget does not call the agent. It posts to `/conversations/messages/inbound`, HighLevel records
the message and fires the `InboundMessage` webhook back, and that is what runs the turn. So a demo
message takes the identical path a real SMS takes, which is the point: the loop is proven end to end
rather than in a shortcut that only works for the demo.

The cost is that the widget needs the tunnel and the app install, and a turn pays two extra network
round trips. If you want the loop without any of that, `pnpm dev:cli` runs turns against the real
harness, real gate, real retrieval and real skills, with no CRM, webhook or tunnel.

## Where to watch it work

| Surface          | URL                             | Shows                                               |
| ---------------- | ------------------------------- | --------------------------------------------------- |
| Practice website | `localhost:5175`                | the customer's view, with the chat widget           |
| Operator product | `localhost:5174`                | LafaGafa itself: agents, knowledge, handover, plans |
| Internal console | `localhost:5174/#/admin`        | every conversation on the platform                  |
| **Trace replay** | `localhost:5174/#/admin/traces` | one turn, step by step, with the assembled prompt   |
| Eval numbers     | `localhost:5174/#/admin/evals`  | what `pnpm gate` last wrote                         |
| Provider chain   | `localhost:5174/#/admin/models` | which model serves which role                       |
| Terminal         | `pnpm trace --full`             | the same rows without a browser                     |

The trace view is the one that answers "why did the agent say that?". It shows the assembled prompt
in full, the provider and model, whether retrieval triggered and why, every chunk with its score
including the ones rejected by the relevance floor, each skill call with its inputs and results,
token counts, and latency per step.

## Commands

```
pnpm dev                    # the server
pnpm dev:cli                # turns against the harness with no CRM, webhook or tunnel
pnpm verify                 # build, typecheck, test, lint, knip, format
pnpm gate                   # the release gate
pnpm gate --all-providers   # per provider, three at a time
pnpm gate --keep-going      # run every stage even after one fails
pnpm eval:gate              # RAG trigger precision and recall
pnpm eval:behaviour         # which skills fired, and which did not
pnpm eval:judge             # groundedness and tone
pnpm eval:review            # asks whether the expectations themselves are right
pnpm bench                  # latency per provider
pnpm trace                  # recent turns as a waterfall
pnpm db:migrate             # apply the schema
pnpm db:reset               # empty the tables, keep the schema and OAuth token
pnpm kb:ingest              # re-index the knowledge base
```

## Functional versus mocked

**Real, against a live GHL sandbox:** OAuth install and token refresh; inbound webhooks with
idempotency and debouncing; Conversations send; Contacts read, update and upsert with merge
detection; Calendars free-slot lookup and appointment creation; handover tagging and CRM notes; the
knowledge base of 19 documents and 80 chunks in pgvector; every trace event, persisted to Postgres;
all four eval suites against real providers; the trace console, which reads the real `trace_events`
table.

**Mocked, and labelled as such in the UI:** the LafaGafa multi-tenant layer of organisations,
sub-accounts, agents, plans, onboarding and config-change audit is fixtures in
`apps/admin/src/mock/`. The harness runs one location, so tenancy is a product shape rather than a
working feature. The eval suite substitutes the CRM so a failing run cannot leave real appointments
in someone's calendar. `apps/chat` is a demonstration practice website, not a real business.

**Known gaps:** three eval cases fail on more than one provider and point at missing SKILL.md
guidance rather than at the models. The judge's "no case below 3" rule leaves the release gate red
on means of 4.4 to 4.8. Streaming is normalised by the SDK but no surface consumes it. All are
detailed in [docs/eval-results.md](docs/eval-results.md).

## Team of one

Four roles, and the tension between them was the real work.

### Product

**Started by researching what HighLevel actually is and who buys it**, because the shape of the
product follows from that and getting it wrong would have shown up in every screen.

HighLevel is a white-label CRM and marketing automation platform. The thing that matters for this
build is who it is sold to: **marketing agencies**, who resell it under their own branding to their
own clients. That produces a two-level hierarchy baked into the platform. An **agency** holds many
**sub-accounts**, one per client business, and a sub-account owns its own contacts, conversations,
calendars and pipelines. Conversations arrive from SMS, email, Facebook, Instagram and web chat into
one inbox, which is why the harness treats channel as an attribute of a message rather than as a
separate integration.

So there are two personas, not one, and they want different things:

- **The agency owner** resells to twenty local businesses. They care about fleet health, which
  client is handing over too often, and whether one bad configuration is costing them a renewal.
  They never want to configure the same thing twenty times.
- **The business owner**, a dental practice or a gym or a salon, has one location and no agency in
  between. They care whether the front desk is covered and whether it says anything embarrassing.

The end customer is the SMB's own customer, who does not know any of this exists and is just asking
whether you are open on Saturday.

Three decisions came out of that research. **The tiering mirrors HighLevel's own**: organisation,
then sub-account, then agent, so an agency operator is never translating between our model and the
CRM they already live in. **A single business is an agency capped at one sub-account**, rather than
a second product, so upgrading does not move anyone somewhere unfamiliar. And **the harness keys on
our own sub-account id, never on the GHL location id**, with one mapping table at the edge, so a CRM
migration is a row update rather than a rewrite of every trace ever stored.

A sub-account is defined by its **knowledge base**, not by its website, which is why one can exist
before a URL is entered and why an agent can carry a second narrower knowledge base of its own.

Built the **LafaGafa** operator product as a prototype on mocked data, so the surface could be
designed against something concrete: onboarding that qualifies a new account and then sets up its
first sub-account, settings as the place an operator changes behaviour without code, and a knowledge
base that is the sub-account rather than an attachment to it.

Set the rule that decided recurring arguments: **record what nothing can act on, act on what
something can.** That killed a "preferred time" field that was never a real CRM field and only ever
produced notes nobody read. A stated time preference is now a calendar search, not a note.

### Design

Kept three surfaces deliberately unalike, because they serve three people: a warm practice website
for a nervous patient, a light product for an operator being sold something, and a dense dark
console for an engineer hunting a number in a waterfall. One visual language would have failed at
least one of them.

Onboarding got the most attention, because it is two jobs wearing one coat: on a new account it asks
who this customer is, and afterwards the same screen is "add a client" and starts halfway down. The
crawl is a timer, but what it shows while running is not decoration. Pages found and facts extracted
are the only evidence an operator gets that we understood their business.

### Engineering

Researched what an agent harness actually is before writing one, and the decision that followed was
what to own versus what to delegate. The AI SDK is used for provider normalisation only:
`generateText` without `stopWhen`, tools without `execute`. Letting the SDK run its own tool loop
would have been fewer lines and would have hidden the reason, act, observe cycle the brief asks to
see.

Owned the abstractions and paid for them. Guards declare their scope, so `contact_is_identified`
applies to booking and not to checking availability. A `guardsFor` helper is exported from core
after the eval suite re-implemented the loop's guard logic and drifted, failing by passing.

### QA

Changed the product most, because it kept proving the other three wrong. The loop was iterative:
run the suite, read the failures, decide whether the agent or the expectation was wrong, and fix
whichever it was. Most fixes landed in `SKILL.md` and `SOUL.md` rather than in code, because most
failures were judgement rather than logic.

Five times a case failed and the **fixture** was wrong, not the agent. That is why
`pnpm eval:review` exists: a suite that asks whether an expectation deserves to be an expectation.
It never fails the build, because a model's opinion on what a receptionist ought to do is not
authoritative.

Writing the tests found more bugs than writing the code did. A gate that dropped half of every
two-part question. A price list that never retrieved, because a markdown table embeds as one blurry
vector. Three stacked timezone bugs. A judge that had been crashing invisibly, so one provider had
never been graded at all.

## What I would build next

Three layers, in order. Each is a different kind of work and they do not block each other.

### Layer 1: make the MVP real

The harness is production shaped. The product around it is fixtures. Turning LafaGafa from a
prototype into something an agency could pay for is a known list, not a research problem:

| Today                                      | For an MVP                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Orgs, sub-accounts and agents are fixtures | Real tables, with the sub-account row already in the schema                                    |
| One `settings.yaml` for one location       | Settings per sub-account, same zod schema, stored rather than read from disk                   |
| A role the browser can choose              | Real auth, and the two doors kept separate                                                     |
| Onboarding crawl is a timer                | Actually crawl the site, extract facts, ingest them                                            |
| One location per deployment                | Route webhooks by location id to the right sub-account, which the tenancy map already supports |

The groundwork that is already in place: every table keys on our own sub-account id rather than the
CRM's location id, and `subAccountIdFor` resolves the mapping once at the edge. Multi-tenancy is a
data-loading change, not a rewrite.

### Layer 2: a build-time harness for improving the agent

Close the loop between what the agent gets wrong and what gets fixed.

Two inputs already exist. Every question the documents could not answer lands in `knowledge_gaps`
with the score that fell short. Every eval failure is named per case with the reply that caused it.
Together they are a queue of candidate work with evidence attached.

What is missing is the rest of the loop:

1. **Cluster** the gaps. Forty people asking about parking in different words is one missing
   document, not forty tickets.
2. **Triage by a human.** Deciding what a receptionist ought to do is a judgement call, and
   `pnpm eval:review` already showed a model disputing fifteen fixtures to find one real problem.
3. **Draft by a coding agent.** An approved item becomes a pull request against the knowledge base,
   a `SKILL.md`, or the code, depending on which of the three the gap actually is.
4. **Gate it.** The same suites that grade the agent guard the change. A proposed fix clears the
   gate, behaviour, judge and latency floors before a human reads the diff, and the eval numbers
   before and after are in the PR body.

Nothing ships without evidence it helped, and nothing gets fixed on a hunch about what the agent
might be getting wrong.

### Layer 3: more skills, in three directions

The three skills cover a first conversation. They do not cover a relationship.

**Finish the appointment lifecycle.** The agent can find slots and book, but it cannot cancel,
reschedule, or look up what someone already has. Those go to a human today, and they are the most
common follow-up a practice gets. Each is one directory under `packages/skills-ghl`, and
`cancel_appointment` needs a guard the others do not: confirm which appointment before touching it.

**Go outbound.** Everything is currently reactive to an inbound webhook. A recall reminder, a
no-show follow-up, or a lapsed-patient nudge is the same loop triggered by a schedule instead of a
message. The queue and the tracer do not care what started a turn.

**Widen the channel and the language.** The CRM already delivers Facebook, Instagram, email and web
chat into the same inbox, and the harness treats channel as an attribute of a message, so the work
is testing rather than plumbing. Two Hinglish cases pass today, which is evidence of nothing at
scale. Real multi-language support means a knowledge base per language and eval cases to match.
