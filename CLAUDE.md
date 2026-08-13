@AGENTS.md

## Before you start

Check whether a skill in `agent-skills/` already covers the task. Each is a playbook that names
every file the change has to touch, which is how a change stays complete rather than plausible.

| Doing this                                | Invoke              |
| ----------------------------------------- | ------------------- |
| Adding a capability the agent can call    | `new-agent-skill`   |
| Adding or fixing eval coverage, incl. after any bugfix | `new-eval-case` |
| Adding a decision or step a reviewer must see | `trace-event`   |
| Reaching a CRM endpoint the client lacks  | `ghl-api-endpoint`  |
| Writing a playbook for a repeated change  | `new-coding-skill`  |

## The rules that get broken

These are in AGENTS.md already. They are repeated as a checklist because they are the ones that
slip:

1. **Comments say why, never what, and never what changed.** Two lines. Longer reasoning goes to
   `docs/architecture.md` under an anchor, and the comment points at it.
2. **Never document what you have not verified.** Read the file, run the command, check the path
   resolves. A described mechanism that does not exist is worse than no documentation.
3. **`pnpm verify` is green, or it is not done.** Never "this should work now".
4. **No drive-by refactors.** Note the unrelated thing in one line at the end instead.
5. **Ask before spending money.** Eval runs and `kb:ingest` call paid APIs. Confirm first.
