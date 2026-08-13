import { existsSync, lstatSync } from "node:fs";
import { mkdir, readlink, symlink, unlink, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates every coding-tool adapter from `AGENTS.md`, the one file a human edits.
 *
 * Cursor, Codex CLI, and Gemini CLI read `AGENTS.md` directly, so they need no adapter at all.
 * Claude Code needs `CLAUDE.md` and discovers skills under `.claude/skills`, so both are
 * generated here. Adding a tool means adding a target below, never a second copy of the rules.
 *
 * `--check` verifies the adapters match without writing, so CI fails on a stale adapter.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE_MD = join(ROOT, "CLAUDE.md");
const SKILLS_SOURCE = join(ROOT, "agent-skills");
const CLAUDE_SKILLS_LINK = join(ROOT, ".claude", "skills");

/*
 * The import carries the rules; the block under it carries the ones that get broken anyway.
 *
 * `@AGENTS.md` alone is correct and insufficient: a long document read once at boot gets skimmed,
 * and the rules that actually get violated are the small procedural ones. Everything below is a
 * pointer into AGENTS.md or agent-skills, never a second copy of a rule, so there is still one
 * place to edit.
 */
const CLAUDE_MD_CONTENT = `@AGENTS.md

## Before you start

Check whether a skill in \`agent-skills/\` already covers the task. Each is a playbook that names
every file the change has to touch, which is how a change stays complete rather than plausible.

| Doing this                                | Invoke              |
| ----------------------------------------- | ------------------- |
| Adding a capability the agent can call    | \`new-agent-skill\`   |
| Adding or fixing eval coverage, incl. after any bugfix | \`new-eval-case\` |
| Adding a decision or step a reviewer must see | \`trace-event\`   |
| Reaching a CRM endpoint the client lacks  | \`ghl-api-endpoint\`  |
| Writing a playbook for a repeated change  | \`new-coding-skill\`  |

## The rules that get broken

These are in AGENTS.md already. They are repeated as a checklist because they are the ones that
slip:

1. **Comments say why, never what, and never what changed.** Two lines. Longer reasoning goes to
   \`docs/architecture.md\` under an anchor, and the comment points at it.
2. **Never document what you have not verified.** Read the file, run the command, check the path
   resolves. A described mechanism that does not exist is worse than no documentation.
3. **\`pnpm verify\` is green, or it is not done.** Never "this should work now".
4. **No drive-by refactors.** Note the unrelated thing in one line at the end instead.
5. **Ask before spending money.** Eval runs and \`kb:ingest\` call paid APIs. Confirm first.
`;

const check = process.argv.includes("--check");
const problems: string[] = [];

async function syncClaudeMd(): Promise<void> {
  const current = existsSync(CLAUDE_MD) ? await readFile(CLAUDE_MD, "utf8") : null;
  if (current === CLAUDE_MD_CONTENT) return;
  if (check) {
    problems.push("CLAUDE.md does not match the generated adapter");
    return;
  }
  await writeFile(CLAUDE_MD, CLAUDE_MD_CONTENT);
  console.log("wrote CLAUDE.md");
}

async function syncSkillsLink(): Promise<void> {
  const target = relative(dirname(CLAUDE_SKILLS_LINK), SKILLS_SOURCE);
  const linked =
    existsSync(CLAUDE_SKILLS_LINK) && lstatSync(CLAUDE_SKILLS_LINK).isSymbolicLink()
      ? await readlink(CLAUDE_SKILLS_LINK)
      : null;

  if (linked === target) return;
  if (check) {
    problems.push(".claude/skills does not point at agent-skills/");
    return;
  }

  await mkdir(dirname(CLAUDE_SKILLS_LINK), { recursive: true });
  if (existsSync(CLAUDE_SKILLS_LINK) || linked !== null) await unlink(CLAUDE_SKILLS_LINK);
  await symlink(target, CLAUDE_SKILLS_LINK, "dir");
  console.log("linked .claude/skills -> agent-skills");
}

await syncClaudeMd();
await syncSkillsLink();

if (problems.length > 0) {
  console.error("agent adapters are stale. Run `pnpm sync:agent`:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
