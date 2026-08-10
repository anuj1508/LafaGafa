# evals

Two suites that must never blur together.

**`deterministic/`** asserts 0/1 facts only, read from the trace and from what the mocked GHL
client received. Did `book_appointment` fire? Did `update_contact` stay silent? Did free-slots get
called before appointment-create? No model judges anything here, so a red result is always a real
regression. These run on every PR.

**`judge/`** scores what cannot be checked exactly — groundedness, tone, handover grace — against
a written rubric, using a model from a different vendor than the one under test. Every judge case
needs a rubric string; a case without one belongs in `deterministic/`.

Rules:

- Fixtures are data (`fixtures/*.yaml`), validated by `fixtures/schema.ts`. Adding a case is
  editing YAML, never writing a new test file.
- Negative cases are first-class. A behavior with no `tools_not_fired` expectation is undertested.
- **Every bug fix lands with a deterministic case that fails without it.** This is the rule the
  suite exists for.
- Report failures. Never quietly narrow an assertion or skip a case to get green — if a case is
  wrong, delete it in its own commit with the reason.
