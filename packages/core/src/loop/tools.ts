import { tool, type ToolSet } from "ai";
import type { Guard, Skill, SkillContext, SkillResult } from "../skills/types.js";
import type { Tracer } from "../tracing/tracer.js";

/**
 * Presents the enabled skills to the model.
 *
 * No `execute`: the SDK would then run its own tool loop, and the reason/act/observe
 * cycle is the thing being judged. Handing back tool calls keeps the control flow in `agent.ts`
 * where a reviewer can read it.
 */
export function toolSetFor(skills: Skill<never>[]): ToolSet {
  const entries = skills.map((skill) => [
    skill.name,
    tool({ description: skill.description, inputSchema: skill.schema }),
  ]);
  return Object.fromEntries(entries) as ToolSet;
}

/**
 * Runs one skill: validate, check guards, execute.
 *
 * Nothing here throws for an expected outcome. A rejected guard, a missing detail, or a failed
 * CRM call all come back as observations the model can act on, because a thrown error would end
 * the turn and leave the customer with silence instead of an explanation.
 */
export async function runSkill(
  skill: Skill<never>,
  rawInput: unknown,
  ctx: SkillContext,
  tracer: Tracer,
): Promise<SkillResult> {
  const startedAt = Date.now();
  tracer.emit({ type: "tool_call", skill: skill.name, args: rawInput });

  const emitResult = (result: SkillResult): SkillResult => {
    tracer.emit({
      type: "tool_result",
      skill: skill.name,
      outcome: result.status,
      result,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  };

  const parsed = skill.schema.safeParse(rawInput);
  if (!parsed.success) {
    return emitResult({
      status: "failed",
      error: `Invalid input for ${skill.name}: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    });
  }
  const input = parsed.data;

  for (const guard of guardsFor(skill, input)) {
    const verdict = await guard.check(input, ctx);
    tracer.emit({
      type: "skill_guard",
      skill: skill.name,
      guard: guard.name,
      passed: verdict.ok,
      ...(verdict.ok ? {} : { reason: verdict.reason }),
    });
    if (!verdict.ok) return emitResult({ status: "blocked", reason: verdict.reason });
  }

  try {
    return emitResult(await skill.execute(input, ctx));
  } catch (error) {
    return emitResult({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The guards that apply to this call, in order. Shared with the eval suite so the two cannot
 * diverge. A guard out of scope is skipped, not passed — a trace should not imply an opinion.
 */
export function guardsFor<I>(skill: Skill<I>, input: I): Guard<I>[] {
  return (skill.guards ?? []).flatMap((entry) => {
    if (!("appliesWhen" in entry)) return [entry];
    return entry.appliesWhen(input) ? [entry.guard] : [];
  });
}

/** What the model reads back as the outcome of its call. */
export function observationFor(result: SkillResult): string {
  switch (result.status) {
    case "ok":
      return result.summaryForModel;
    case "blocked":
      return `Blocked: ${result.reason}`;
    case "needs_input":
      return `Cannot proceed yet: ${result.ask}`;
    case "handover":
      return `Handed to a human: ${result.reason}`;
    case "failed":
      return `Failed: ${result.error}`;
  }
}
