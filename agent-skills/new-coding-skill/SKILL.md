---
name: new-coding-skill
description: Write a new playbook under agent-skills/ for a recurring multi-file coding task. Use when a change keeps being done incompletely, or when asked to add a skill for the coding agent rather than for the running agent.
---

# Adding a coding-agent playbook

A playbook is a checklist for one kind of change, written for whoever does it next. It exists
because some changes touch five files and get done in three, and the two that get missed are always
the same two.

This is not the same as a runtime skill. If the ask is a capability the shipped agent can call, such
as cancelling an appointment, use `new-agent-skill` instead.

## Rule or playbook

Put it in `AGENTS.md` when it applies to every change: comment style, the boundary rules, what done
means. Put it in `agent-skills/` when it applies to one recurring task and names specific files.

"Comments say why, not what" is a rule. "Adding a trace event means events.ts, then the emitter,
then the console, then a fixture" is a playbook. A rule you have to read on every task is a cost; a
playbook you read only when it applies is not.

If you cannot name the files it touches, it is a rule, not a playbook.

## What to create

One file: `agent-skills/<name>/SKILL.md`.

```
---
name: <kebab-case, matching the directory>
description: <what it does, then when to use it>
---
```

No registration. `.claude/skills` symlinks `agent-skills/`, so the directory is discovered on its
own. Tools reading `AGENTS.md` directly get it through the same path.

**The description decides whether the playbook is ever used.** It is the only part a tool sees when
deciding what to invoke, so write it as a trigger rather than a summary. "Add a typed method to the
GoHighLevel client. Use when the harness needs a CRM capability it cannot currently reach" beats
"documentation for the GHL client". Name the phrases someone would actually type.

## What goes inside

- **Every file the change touches**, in the order they should be edited, with the path.
- **The contract at each step**: what the type requires, what must never be thrown, what has to be
  registered.
- **The check before claiming done.** Always includes `pnpm verify`, plus whatever is specific:
  a trace event has to appear in the console, a skill has to work against the mocked CRM offline.
- **The failure this playbook exists to prevent**, in one line. A playbook without a named failure
  is a summary of the code, and the code is already there.

Keep it under about 60 lines. A playbook nobody finishes reading is a playbook nobody follows.

## Check before you claim done

- `pnpm sync:agent` runs clean and `pnpm verify` is green.
- The description names a phrase somebody would plausibly type.
- Every path in it resolves. A playbook that points at a file that moved is worse than none,
  because it is trusted.
