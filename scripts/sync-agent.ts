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

const CLAUDE_MD_CONTENT = `@AGENTS.md\n`;

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
