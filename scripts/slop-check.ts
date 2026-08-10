import { execFileSync } from "node:child_process";

/**
 * Catches the prose failure modes no linter has an opinion about: comments that narrate the edit
 * instead of explaining the code, chat register left in source, and emoji. These are cheap to
 * write and expensive to review, so they are blocked at commit time rather than in review.
 *
 * Runs over staged additions only — existing lines are not this script's business.
 */

const BANNED: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /^\+\s*(?:\/\/|\*|#)\s*(?:here'?s|i'?ve|i have|as requested|let me|now (?:we|i))\b/i,
    why: "comment narrates the edit instead of explaining the code",
  },
  {
    // Line comments only. A `*` continuation line starts mid-sentence, so a verb appearing at the
    // start of one is usually an adjective — "fixed at 1536 dimensions", "new patients are seen"
    // — and this rule flagged two of those for every real catch. Archaeology worth blocking looks
    // like `// added to fix the 401`, which is a line comment by nature.
    pattern: /^\+\s*(?:\/\/|#)\s*(?:added|updated|changed|removed|fixed)\b.*\b(?:to|for|so)\b/i,
    why: "comment is change archaeology — git already records it",
  },
  {
    pattern: /^\+.*\b(?:TODO|FIXME|XXX|HACK)\b/,
    why: "unfinished-work marker; finish it or open an issue",
  },
  {
    pattern: /^\+.*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    why: "emoji in source",
  },
  {
    pattern: /^\+\s*(?:\/\/|\*|#)\s*(?:eslint-disable|@ts-ignore)(?!.*--)/,
    why: "suppression without a reason; add `-- <why>` or fix the code",
  },
];

/** Only text we author. Generated output and lockfiles are not ours to police. */
// This file is excluded from its own scan: the rule patterns above necessarily spell out the
// words they ban, so scanning it would report every rule as a violation of itself.
const SKIP_PATHS =
  /(?:^|\/)(?:pnpm-lock\.yaml|dist|node_modules|migrations|CLAUDE\.md|slop-check\.ts)(?:\/|$)/;

function stagedDiff(): string {
  return execFileSync("git", ["diff", "--cached", "--unified=0", "--no-color"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function main(): void {
  const violations: string[] = [];
  let file = "";

  for (const line of stagedDiff().split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header?.[1]) {
      file = header[1];
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++") || SKIP_PATHS.test(file)) continue;

    for (const { pattern, why } of BANNED) {
      if (pattern.test(line)) {
        violations.push(`${file}: ${why}\n    ${line.slice(1).trim()}`);
        break;
      }
    }
  }

  if (violations.length > 0) {
    console.error(`slop-check found ${violations.length} problem(s):\n`);
    for (const violation of violations) console.error(`  ${violation}\n`);
    process.exit(1);
  }
}

main();
