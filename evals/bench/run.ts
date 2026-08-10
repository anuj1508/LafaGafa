import type { ProviderName } from "@harness/config";
import type { TraceEvent } from "@harness/core";
import { loadPrompts, runCase, type EvalCase } from "../behaviour/harness.js";

/* eslint-disable no-console -- this command's output is its report */

/**
 * Measures where a turn's time goes, per span and per provider, against p50 <= 3s / p95 <= 6s.
 * Harness spans only — the tunnel and the CRM round trip are deployment facts. Flags: --provider, --runs.
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const providers = (flag("provider") ?? "anthropic").split(",") as ProviderName[];
const runs = Number(flag("runs") ?? 12);

/** Non-RAG, tool-free turns: the ones the SLO is written about. */
const NON_RAG: EvalCase[] = [
  {
    id: "b1",
    behavior: "gate",
    input: "hi",
    history: [],
    expect: { fired: [], not_fired: [] },
    must_not_contain: [],
    must_not_write: {},
  },
  {
    id: "b2",
    behavior: "gate",
    input: "thanks",
    history: [],
    expect: { fired: [], not_fired: [] },
    must_not_contain: [],
    must_not_write: {},
  },
  {
    id: "b3",
    behavior: "gate",
    input: "ok great",
    history: [],
    expect: { fired: [], not_fired: [] },
    must_not_contain: [],
    must_not_write: {},
  },
  {
    id: "b4",
    behavior: "gate",
    input: "perfect, cheers",
    history: [],
    expect: { fired: [], not_fired: [] },
    must_not_contain: [],
    must_not_write: {},
  },
];

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};

const { soul, proceduralDocs } = await loadPrompts();

interface Span {
  name: string;
  ms: number;
}

function spansOf(events: readonly TraceEvent[]): Span[] {
  return events.flatMap((event) => {
    if (!("latencyMs" in event) || typeof event.latencyMs !== "number") return [];
    const name =
      event.type === "llm_call"
        ? `llm_call:${event.role}`
        : event.type === "gate"
          ? "gate"
          : event.type;
    return [{ name, ms: event.latencyMs }];
  });
}

console.log(`SLO: p50 ≤ 3000ms, p95 ≤ 6000ms  ·  non-RAG turns  ·  ${runs} runs per provider\n`);

let breached = false;

for (const provider of providers) {
  const totals: number[] = [];
  const bySpan = new Map<string, number[]>();

  for (let run = 0; run < runs; run += 1) {
    const testCase = NON_RAG[run % NON_RAG.length];
    if (!testCase) continue;
    const startedAt = Date.now();
    try {
      const outcome = await runCase(testCase, provider, undefined, soul, proceduralDocs);
      totals.push(Date.now() - startedAt);
      for (const span of spansOf(outcome.events)) {
        bySpan.set(span.name, [...(bySpan.get(span.name) ?? []), span.ms]);
      }
      process.stdout.write(".");
    } catch {
      process.stdout.write("E");
    }
  }

  const p50 = percentile(totals, 0.5);
  const p95 = percentile(totals, 0.95);
  const withinSlo = p50 <= 3000 && p95 <= 6000;
  if (!withinSlo) breached = true;

  console.log(`\n\n${provider}`);
  console.log(
    `  turn total    p50 ${String(p50).padStart(6)}ms   p95 ${String(p95).padStart(6)}ms   ${withinSlo ? "within SLO" : "OVER SLO"}`,
  );
  for (const [name, values] of [...bySpan].sort()) {
    console.log(
      `  ${name.padEnd(14)}p50 ${String(percentile(values, 0.5)).padStart(6)}ms   p95 ${String(percentile(values, 0.95)).padStart(6)}ms   (${values.length})`,
    );
  }
}

console.log(
  `\nMeasured across the harness's own spans. The CRM round trip and the tunnel are excluded — ` +
    `they are deployment facts, and including them hides which span is slow. The end-to-end figure ` +
    `is on the console overview.`,
);
console.log(`\n${breached ? "OVER SLO" : "within SLO"}`);
process.exit(breached ? 1 : 0);
