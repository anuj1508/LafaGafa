---
name: new-agent-skill
description: Scaffold a new runtime skill (a capability the agent can call) with its schema, guards, procedural doc, and eval cases. Use when asked to add a skill such as "cancel appointment" or "check order status".
---

# Adding a runtime skill

A skill is one file plus its tests. If you find yourself editing `packages/core`, stop — the
extensibility claim is that you don't have to, and something is wrong with the design instead.

## What to create

1. **`packages/skills-ghl/src/<skill-name>/index.ts`** — the `Skill<I>` implementation.
   - `name` is snake_case and is what appears in traces and eval fixtures.
   - `description` is written for the model, not for a human reading the code. Say when to call
     it and, just as importantly, when not to.
   - `schema` is zod. Every field the model must supply, nothing it should infer. The package
     carries no zod dependency until a skill needs one — add it with
     `pnpm add zod --filter @harness/skills-ghl`, since pnpm will not resolve an undeclared
     import.
   - `execute` returns a `SkillResult`. Never throw for an expected outcome — no availability is
     `ok` with empty data, a missing detail is `needs_input`, a rejected precondition is
     `blocked`. Throwing is reserved for genuine faults.

2. **Guards** in `guards.ts` beside it. Each guard is a pure function returning `{ ok: true }` or
   `{ ok: false, reason }`, where `reason` is written to be read by the model and relayed to the
   customer. Guards are the negative-case mechanism: "this skill must not fire when X" becomes a
   guard plus an eval, never a sentence in a prompt.

3. **`skills/<skill-name>/SKILL.md`** — the procedural doc injected into the system prompt when
   the skill is enabled. Behavioural instructions live here, in version control, not in string
   literals. Frontmatter: `name`, `description`, `triggers`. The top-level `skills/` directory is
   created by the first skill that needs it; it is separate from `agent-skills/`, which is for
   coding agents rather than for the running agent.

4. **Registration** — one `.register(...)` line in `createGhlSkillRegistry` in
   `packages/skills-ghl/src/index.ts`. That is the entire integration cost, and keeping it that
   way is the point. If you find yourself editing anything under `packages/core` to make a skill
   work, the design is wrong — say so rather than working around it.

5. **Settings** — anything an operator would tune (limits, allowlists, tags, templates) goes into
   `packages/config/src/settings.ts` with a default. Hard-coded policy is a bug.

6. **Eval cases** in `evals/fixtures/` — at minimum one happy path, one case per guard asserting
   `tools_not_fired`, and one ambiguous input where the right answer is a clarifying question and
   no tool call at all.

## Check before you claim done

- The skill's own tests pass with the mocked GHL client, offline.
- A guard failure produces a reply that neither claims success nor invents a reason.
- `pnpm lint typecheck test` is green.
