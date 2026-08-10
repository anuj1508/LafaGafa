# Eval results

Measured 11 August 2026, against a database cleared immediately beforehand. Reproduce with
`pnpm gate --all-providers --keep-going`.

The run finished **red**: every stage ran, and two did not clear their floors. Both are the judge,
and both are the same strict rule rather than a mean below target — see "Why the run is red".

## What the suites are, and why there are four

Each answers a question the others cannot.

| Suite         | Command               | Asks                                                      | Shape of answer                             |
| ------------- | --------------------- | --------------------------------------------------------- | ------------------------------------------- |
| **Gate**      | `pnpm eval:gate`      | Should this turn have searched the knowledge base?        | Precision and recall over 57 labelled turns |
| **Behaviour** | `pnpm eval:behaviour` | Did the right skills fire, and the wrong ones stay quiet? | 0/1 facts read off the trace, 89 cases      |
| **Judge**     | `pnpm eval:judge`     | Was the answer grounded, and did it read well?            | 1–5 against a rubric, 56 cases              |
| **Latency**   | `pnpm bench`          | How long does a non-RAG turn take?                        | p50 and p95 per provider                    |

**Gate** is separate from behaviour because retrieving is a decision, not an outcome. Recall carries
a higher floor (95%) than precision (85%) on purpose: a turn that needed documents and skipped them
produces a wrong answer, while a turn that searched needlessly costs only latency. The two errors
are not equal and the floors say so.

**Behaviour** replays the real loop, the real skills, the real guards and the real prompts. Only the
CRM is a mock — a suite that also stubbed the loop would be testing its own fixtures. Assertions are
facts off the trace: which skills fired, whether the gate retrieved, whether it handed over, what
was written to which field. **40 of the 89 cases assert that something must _not_ happen**, because
a suite of happy paths passes an agent that also books appointments nobody asked for.

**Judge** covers what cannot be checked exactly — whether a refusal was graceful, whether every
claim traces to a passage. No vendor grades its own replies.

**Latency** measures the harness's own spans and deliberately excludes the tunnel and the CRM round
trip. Those are deployment facts, and including them hides which span is actually slow.

A fifth, `pnpm eval:review`, points the other way: it asks whether an _expectation_ is right, rather
than whether the agent met it. It never fails the build. See "the fixtures were wrong" below.

## Models

The cheap tier of each vendor, so the comparison is like for like.

| Role       | Anthropic                                       | OpenAI        | Google                  |
| ---------- | ----------------------------------------------- | ------------- | ----------------------- |
| Chat       | `claude-haiku-4-5`                              | `gpt-4o-mini` | `gemini-3.5-flash-lite` |
| Gate       | same as chat                                    | same as chat  | same as chat            |
| Judge      | —                                               | `gpt-4o`      | `gemini-3.5-flash-lite` |
| Embeddings | `text-embedding-3-small` (OpenAI) for all three |               |                         |

The gate runs on the provider under test rather than a fixed vendor. Otherwise a "Google" row would
measure Google's chat with Anthropic's gate, which compares nothing.

## Gate — RAG trigger, 57 cases

| Provider   | Accuracy | Precision (floor 85%) | Recall (floor 95%) | False skips | Decided free | Timed out | p50        |
| ---------- | -------- | --------------------- | ------------------ | ----------- | ------------ | --------- | ---------- |
| Anthropic  | 96.5%    | 96.7%                 | 96.7%              | 1           | 15/57        | 1         | 1161 ms    |
| OpenAI     | 98.2%    | 96.8%                 | **100%**           | 0           | 15/57        | 3         | 1273 ms    |
| **Google** | **100%** | **100%**              | **100%**           | **0**       | 15/57        | **0**     | **740 ms** |

All three clear both floors. 15 of 57 turns are decided by a regex before any model is called.

Anthropic's single false skip is `amb-how-long` — "how long does it take?" — judged too vague to
search. Defensible, and still the failure that matters most, because the customer is told we do not
know something the documents cover. Its one false retrieve, `confirm-email`, is not a judgement at
all: the gate call timed out and **failed open**, which is the designed behaviour and the right one.
OpenAI timed out three times the same way. Google timed out zero times.

That fail-open column is worth reading alongside the accuracy. A gate that errors and retrieves
anyway scores as a false retrieve, costing latency — which is the cheap direction to fail in.

## Behaviour — 89 cases

| Behaviour      | Cases  | Anthropic      | OpenAI         | Google         |
| -------------- | ------ | -------------- | -------------- | -------------- |
| update_contact | 20     | 19/20          | 18/20          | 18/20          |
| booking        | 20     | 19/20          | 19/20          | **20/20**      |
| handover       | 20     | 19/20          | 18/20          | 19/20          |
| rag            | 20     | **20/20**      | **20/20**      | **20/20**      |
| gate           | 3      | 3/3            | 3/3            | 3/3            |
| multi_intent   | 3      | 3/3            | 3/3            | 3/3            |
| purpose        | 3      | 3/3            | 3/3            | 3/3            |
| **Total**      | **89** | **86 (96.6%)** | **84 (94.4%)** | **86 (96.6%)** |

Every one of the 60 retrieval cases passes on every provider. The failures cluster in exactly the
place the negative corpus was built for.

## Judge — groundedness and tone, 56 rubric cases

| Provider  | Graded by `gpt-4o`   | Graded by `gemini-3.5-flash-lite` |
| --------- | -------------------- | --------------------------------- |
| Anthropic | **4.73** (2 below 3) | **4.82** (1 below 3)              |
| Google    | 4.55 (5 below 3)     | — grades itself                   |
| OpenAI    | — grades itself      | 4.42 (7 below 3, 55 cases)        |

**Anthropic is graded by both, which is the useful number here.** The previous run could not compare
graders and had to warn that OpenAI's row was "pessimistic by an unknown margin" because a cheaper
model scored it. On the one provider both graded, they agree within 0.09 — and the cheap grader was
slightly _more_ generous, not less. That does not make the rows strictly comparable, but it bounds
the error at roughly a tenth of a point rather than leaving it unknown.

OpenAI shows 55 cases rather than 56 because one behaviour case died on a rate limit, leaving no
reply to grade.

## Latency — non-RAG turns, 12 runs each

Target p50 ≤ 3s, p95 ≤ 6s.

| Provider   | p50        | p95        | Verdict             |
| ---------- | ---------- | ---------- | ------------------- |
| Anthropic  | 1161 ms    | 2041 ms    | within              |
| OpenAI     | 1436 ms    | 3257 ms    | within              |
| **Google** | **766 ms** | **940 ms** | within, comfortably |

The turn is one model call — Anthropic's `llm_call` is 1152 ms of its 1161. Nothing else is worth
optimising on a non-RAG turn.

The previous run put Anthropic's p95 at 5999 ms against a 6000 ms budget, and this document said
that was "one slow call away from breaching". At 2041 ms it now has real headroom. Two runs is not
a distribution, so read this as the earlier figure having been a bad tail rather than as an
improvement anyone engineered.

**RAG turns are much slower and are not covered by this SLO.** A two-part question measured 9.4 s
end to end, of which 6.2 s was retrieval — see "the database was never the cost".

# Why the run is red

Both judge stages failed, neither on the mean. The rule is that **no case may score below 3**, and
Anthropic had 2, Google 5, OpenAI 7. Every mean clears the 4.0 floor comfortably.

That rule is defensible for a release gate and wrong for a comparison run: one harshly-scored case
out of 56 turns a 4.8 average into a failure. It is left as-is because changing a threshold to make
a red run green, in the same session that produced the numbers, is how a gate stops meaning
anything. `--keep-going` was the right fix instead: every stage runs and reports, and the exit code
stays non-zero.

## Two cases fail on more than one provider — those are mine, not the models'

| Case                     | Fails on                  | What happens                                                     |
| ------------------------ | ------------------------- | ---------------------------------------------------------------- |
| `uc-not-relative-detail` | Anthropic, OpenAI, Google | A relative's detail is written onto the caller's own contact     |
| `uc-not-third-party`     | OpenAI, Google            | "my wife's name is Sarah" — recorded as the contact's own name   |
| `ho-legal`               | Anthropic, Google         | A solicitor's records request is answered instead of handed over |

A case that fails across vendors is not a model weakness, it is missing guidance. `update_contact`'s
SKILL.md rule about third parties covers an email address but not a name or a relative's age, and
`human_handover`'s never mentions records requests or legal correspondence. **`uc-not-relative-detail`
fails on all three**, which makes it the clearest documentation gap in the build.

These are left unpatched rather than fixed, because fixing them here would make the numbers describe
a build that did not produce them.

## The judge crashed, and had been crashing invisibly

`judge · graded by google` died on its 14th case:

````
SyntaxError: Unexpected token '`', "```json
````

Gemini returned a verdict truncated mid-JSON — an opening fence, no closing brace. `extractJson`
looks for a closing fence, then falls back to slicing between `{` and `}`; a truncated reply defeats
both, so the raw string reached `JSON.parse` and threw. The file already had an "unparseable
verdict" branch that scores such a case 0 — the guard was simply one line too late, sitting after
the parse instead of around it.

**This is why OpenAI had never been judged.** The stage always crashed, and because the gate used to
halt at the first failure, the crash sat behind a stage that failed earlier and was never reached.
`--keep-going` surfaced it on the first run.

Fixed by moving the parse inside the guard, and by raising the judge's token budget from 600 to
1500: `--judge` can point that binding at a reasoning model, whose thinking is charged to the same
budget. This is the third time a too-small token budget has produced a wrong answer rather than an
error — the gate at 60 tokens once scored a fake 78.9% the same way.

## OpenAI's failures

Four of its five behaviour failures are over-firing — doing something when it should have done
nothing. `uc-not-third-party` and `uc-not-relative-detail` write a relative's details onto the
caller. `ho-not-complaint-about-someone-else` escalates a complaint about a _previous_ dentist.

Its judge row shows the same shape plus a grounding weakness: `rag-knocked-out-tooth` omits the
milk-not-water advice, `rag-nervous` omits the longer-appointments offer, `rag-late-cancellation`
omits the £35 charge. The passages were retrieved — all 20 rag behaviour cases pass — so this is the
model leaving material on the table, not a retrieval failure.

One failure is not the agent's at all: `ho-not-terse` hit an OpenAI tokens-per-minute limit. The
runner already retries once after a pause; this one exhausted it. OpenAI's honest score is 84/89
with that caveat attached.

## Anthropic and Google

Anthropic misses `bk-two-people` (asked for two back-to-back appointments, does not search),
`ho-legal`, and `uc-not-relative-detail`. Google misses `uc-not-third-party`,
`uc-not-relative-detail` and `ho-legal`. Google's `ho-emergency-out-of-hours` failure from the
previous run did not reproduce, which is a reminder that single-run differences of one case are
noise.

## The database was never the cost

Retrieval measured 6.2 s on a two-part question, and the obvious explanations were both wrong.
`EXPLAIN ANALYZE` reported **0 ms execution and 0 ms planning** over an HNSW index; shipping two
29.5 KB embedding literals in parallel cost 335 ms. Neither pgvector nor bandwidth.

The cost was opening a Postgres connection — ~3.5 s, about six round trips for TCP, TLS and SCRAM
before a byte of SQL, against a database 377 ms away. node-pg closes idle connections after 10 s by
default, so any conversation with a pause between messages found an empty pool, and the second query
of a two-query retrieval paid the handshake mid-turn.

Fixed by keeping idle connections and warming the pool at boot. Measured on the same shape:
**6163 ms → 2351 ms**. The lesson is not about Postgres — it is that two plausible explanations both
survived casual reasoning and died on measurement.

## Three contaminated results, caught before they became findings

All three would have shipped as facts about a model.

**Google's gate once measured 78.9% accuracy, 71.4% precision.** It was not measuring Gemini at all.
`gemini-2.5-flash` is closed to new API keys, every gate call errored, and the gate failed open — so
it "retrieved" on everything. The shape of the result (perfect recall, poor precision) is exactly
what a fail-open default looks like, which is what gave it away. On a current model the same suite
scores 100/100/100.

**The judge once ran on `gpt-4o-mini` instead of `gpt-4o`** because the `--judge` override picked the
chain's chat entry. The cheap model inverts negative rubrics: `uc-not-third-party` was scored 1/5
with the reason _"the assistant fails to address the customer as Sarah"_ — when the rubric requires
that it must **not**.

**Three rate-limit failures were once counted as behaviour failures.** A 429 is the harness being
told to slow down, not the agent behaving badly. The runner now retries once after a pause —
deliberately in the eval harness and not in `callModel`, because production answers a rate limit by
failing over to another vendor and a per-provider measurement must never silently switch.

## The fixtures were wrong five times

Across this project, five cases failed where the agent was right and the expectation was not: a
stated time preference that should be searched rather than filed; a 6am request answered from
opening hours rather than a calendar lookup; a `must_not_contain: ["£"]` that failed a reply for
correctly quoting a _different_ treatment's price; and two more.

This is why `pnpm eval:review` exists. It reads each case, argues the opposite side, and prints only
where it disagrees — it never fails the build, because a model's opinion on what a receptionist
ought to do is not authoritative. Run over all 89 it disputed 15, of which one was a real finding:
`fired: [book_appointment]` could not distinguish _looking_ from _booking_, so the anonymous-caller
case was not asserting the thing it existed to assert. Assertions now accept
`book_appointment:check_slots`.

One in fifteen is the honest value of that tool. It is a net, not an oracle.

## What these numbers do not cover

- **One run each.** No variance bands. Behaviour on a language model is not deterministic, and
  single-run differences of one or two cases should not be read as rankings. Anthropic's p95 moving
  5999 → 2041 ms between runs is the clearest illustration.
- **A mocked CRM.** Rate limits, partial writes and GHL's own latency are absent by design.
- **English only**, two Hinglish cases aside.
- **One knowledge base**, 19 documents and 80 chunks, one business. Retrieval quality against a
  larger or messier corpus is unmeasured.
- **RAG-turn latency has no floor in the gate.** The SLO covers non-RAG turns only, and the 9.4 s
  figure above is measured against a database on another continent.
