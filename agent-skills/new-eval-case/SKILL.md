---
name: new-eval-case
description: Add or fix eval cases in the deterministic or judge suite. Use when adding coverage for a behavior, and always when fixing a bug.
---

# Adding an eval case

## The rule that matters most

**Every bug fix lands with a deterministic case that fails without the fix.** Write the case
first, watch it fail, then fix. A bug that was only fixed can come back; a bug that was locked
cannot.

## Which suite

Ask one question: _can this be checked exactly?_

- Did a tool fire, with what arguments, in what order? Did the gate retrieve? Did handover set the
  flag? → **`deterministic/`**. Assert on trace events and on what the mocked GHL client received.
  Never assert on reply wording here beyond required substrings.
- Is the answer grounded, is the tone right, was the handover graceful? → **`judge/`**, with a
  written rubric. The judge sees the reply and the retrieved chunks — never a gold answer, because
  scoring against a gold answer measures paraphrase, not grounding.

## Writing the case

Cases are YAML in `evals/fixtures/`, validated by `fixtures/schema.ts`. Fill in:

- `id` — `<behavior>-<what-is-special>`, e.g. `booking-slot-taken-mid-flow`.
- `history` — only the prior turns that matter. A long transcript hides what is under test.
- `expect.tools_not_fired` — **do not skip this.** A case that only asserts the happy path lets a
  regression that fires three extra skills pass.
- `expect.reply_must_not_contain` — for RAG cases, seed a fact the KB does not contain (a price, a
  policy number) and assert it never appears. This is the fabrication trap.

## Volume

The target is 20–30 cases per behavior. Get there by hand-writing 8–10 seeds that each test a
distinct decision, then paraphrasing for tone, typos, verbosity, and code-switching. Paraphrases
extend coverage of robustness; they do not extend coverage of behavior, so do not count them as
new decisions covered.

## Reporting

Failures are published, not hidden. Never loosen an assertion to get green. If a case is genuinely
wrong, delete it in its own commit and say why in the message.
