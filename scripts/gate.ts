import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The release gate. Stages run cheapest-first and a failure stops the run; `--all-providers` runs
 * the three vendors concurrently, one stream each. See docs/architecture.md#eval-suites.
 */

interface Stage {
  name: string;
  command: string;
  args: string[];
  why: string;
}

const PROVIDERS = ["anthropic", "openai", "google"] as const;
const allProviders = process.argv.slice(2).includes("--all-providers");

const ALL_PROVIDER_STAGES: Stage[] = [
  {
    name: "judge · graded by openai",
    command: "pnpm",
    args: ["eval:judge", "--judge", "openai"],
    why: "groundedness for anthropic and google",
  },
  {
    name: "judge · graded by google",
    command: "pnpm",
    args: ["eval:judge", "--judge", "google"],
    why: "groundedness for openai, which its own vendor may not grade",
  },
  {
    name: "latency · all providers",
    command: "pnpm",
    args: ["bench", "--provider", PROVIDERS.join(",")],
    why: "non-RAG turns against the SLO, per vendor",
  },
];

const STAGES: Stage[] = [
  {
    name: "verify",
    command: "pnpm",
    args: ["verify"],
    why: "build, typecheck, unit tests, lint, dead code, formatting",
  },
  {
    name: "gate accuracy",
    command: "pnpm",
    args: ["eval:gate"],
    why: "retrieval gate precision and recall against labelled cases",
  },
  {
    name: "behaviour",
    command: "pnpm",
    args: ["eval:behaviour"],
    why: "which skills fired, and which did not, through the real loop",
  },
  {
    name: "judge",
    command: "pnpm",
    args: ["eval:judge"],
    why: "groundedness and tone, scored on a different vendor",
  },
  {
    name: "latency",
    command: "pnpm",
    args: ["bench"],
    why: "non-RAG turns against the SLO",
  },
];

const started = Date.now();
const passed: string[] = [];
const failedStages: string[] = [];

// Runs every stage even after one fails, for a run whose job is to produce a full set of numbers.
// The exit code is still non-zero. See #keep-going.
const keepGoing = process.argv.slice(2).includes("--keep-going");

/**
 * The per-provider suites, three at a time.
 *
 * Output is buffered per provider and printed when that provider finishes, because three
 * interleaved progress streams are unreadable. A vendor that fails does not stop the others: the
 * whole point of the run is the comparison, and two rows plus a named failure beats one row.
 */
async function runProvidersInParallel(): Promise<string[]> {
  const started = Date.now();
  console.log(`\n${"━".repeat(78)}`);
  console.log(`per-provider suites  —  ${PROVIDERS.join(", ")}, concurrently\n`);

  const results = await Promise.all(
    PROVIDERS.map(async (provider) => {
      const lines: string[] = [];
      let failed: string | null = null;
      for (const suite of [
        ["eval:gate", "--provider", provider],
        ["eval:behaviour", "--provider", provider],
      ]) {
        try {
          const { stdout } = await run("pnpm", suite, { maxBuffer: 32 * 1024 * 1024 });
          lines.push(stdout);
        } catch (error) {
          const shell = error as { stdout?: string; stderr?: string };
          lines.push(shell.stdout ?? "", shell.stderr ?? "");
          // Keep going. A vendor whose gate misses its floor still has behaviour numbers, and the
          // comparison is what this run is for — stopping here would hide the interesting half.
          failed = failed ? `${failed}, ${suite[0] ?? "suite"}` : (suite[0] ?? "suite");
        }
      }
      return { provider, output: lines.join("\n"), failed };
    }),
  );

  const done: string[] = [];
  for (const result of results) {
    console.log(`\n${"─".repeat(78)}\n${result.provider}\n${"─".repeat(78)}`);
    console.log(result.output.trim());
    if (result.failed) console.log(`\n${result.provider}: ${result.failed} did not pass.`);
    else done.push(result.provider);
  }
  console.log(
    `\nper-provider suites finished in ${Math.round((Date.now() - started) / 1000)}s — ` +
      `${done.length} of ${PROVIDERS.length} clean`,
  );
  return done;
}

const stages = allProviders ? ALL_PROVIDER_STAGES : STAGES;

if (allProviders) {
  console.log(`\n${"━".repeat(78)}\nverify  —  build, typecheck, unit tests, lint, dead code\n`);
  try {
    execFileSync("pnpm", ["verify"], { stdio: "inherit" });
    passed.push("verify");
  } catch {
    failedStages.push("verify");
    // A broken build makes every number after it meaningless, so this is the one stage worth
    // stopping for even under --keep-going.
    if (!keepGoing) process.exit(1);
    console.log("\nverify did not pass. Continuing, but treat what follows with suspicion.");
  }
  passed.push(...(await runProvidersInParallel()).map((provider) => `suites · ${provider}`));
}

for (const [index, stage] of stages.entries()) {
  console.log(`\n${"━".repeat(78)}\n${stage.name}  —  ${stage.why}\n`);
  try {
    execFileSync(stage.command, stage.args, { stdio: "inherit" });
    passed.push(stage.name);
  } catch {
    failedStages.push(stage.name);
    if (keepGoing) {
      console.log(`\n${stage.name} did not pass. Continuing — see the summary at the end.`);
      continue;
    }
    // Indexed off the stage list, never off `passed`: with --all-providers that array already
    // holds the provider suites, so counting it reported every skipped stage as "none".
    const skipped = stages.slice(index + 1).map((entry) => entry.name);
    console.log(`\n${"━".repeat(78)}`);
    console.log(`GATE FAILED at "${stage.name}".`);
    console.log(`Passed before it: ${passed.length > 0 ? passed.join(", ") : "none"}`);
    console.log(`Not run: ${skipped.length > 0 ? skipped.join(", ") : "none"}`);
    process.exit(1);
  }
}

if (failedStages.length > 0) {
  console.log(`\n${"━".repeat(78)}`);
  console.log(`GATE RED — every stage ran, ${String(failedStages.length)} did not pass.`);
  console.log(`Passed: ${passed.length > 0 ? passed.join(", ") : "none"}`);
  console.log(`Failed: ${failedStages.join(", ")}`);
  console.log(`Results written to evals/.results regardless.`);
  process.exit(1);
}

console.log(`\n${"━".repeat(78)}`);
console.log(`GATE GREEN — ${passed.join(", ")} in ${Math.round((Date.now() - started) / 1000)}s`);
