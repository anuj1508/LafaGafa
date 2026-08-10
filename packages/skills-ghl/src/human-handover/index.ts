import type { Skill } from "@harness/core";
import { z } from "zod";
import type { GhlSkillDeps } from "../deps.js";
import { triggerIsEnabled } from "./guards.js";

const inputSchema = z.object({
  trigger: z
    .enum(["explicit_request", "frustration", "out_of_scope", "repeated_failure"])
    .describe("Why a person is needed. Use explicit_request when they simply asked for one."),
  evidence: z
    .string()
    .min(1)
    .describe("The customer's own words that justify this, quoted. Never paraphrase."),
  summary: z
    .string()
    .min(1)
    .describe(
      "A brief for the colleague taking over: what the customer wants, what they have already " +
        "told you, what you tried, and what is still outstanding. Written for someone who has " +
        "not read the thread.",
    ),
});

export type HumanHandoverInput = z.infer<typeof inputSchema>;

/**
 * Stops the agent and marks the conversation for a person. The kill switch goes first, always:
 * a failure after it leaves the agent silent, a failure before it leaves it talking over someone.
 */
export function createHumanHandoverSkill(deps: GhlSkillDeps): Skill<HumanHandoverInput> {
  return {
    name: "human_handover",
    description:
      "Hand this conversation to a human and stop replying. Use when the customer asks for a " +
      "person, is clearly frustrated, or wants something outside what you can do. Honour an " +
      "explicit request immediately — never try to talk someone out of it.",
    schema: inputSchema,
    guards: [triggerIsEnabled],
    proceduralDoc: "skills/human_handover/SKILL.md",

    async execute(input, ctx) {
      const { handover } = ctx.settings;

      await deps.silenceAgent({
        locationId: ctx.locationId,
        conversationId: ctx.conversationId,
        reason: input.trigger,
      });

      const patch = {
        tags: handover.tags,
        ...(handover.assignTo ? { assignedTo: handover.assignTo } : {}),
      };
      await deps.contacts(ctx.locationId).update(ctx.contactId, patch);

      // The brief is what turns a tagged conversation into one a colleague can actually pick up.
      // Failing to leave it must not undo the handover itself, which has already happened.
      try {
        await deps
          .contacts(ctx.locationId)
          .addNote(
            ctx.contactId,
            `Handed over by the assistant (${input.trigger}).\n\n${input.summary}\n\nTheir words: "${input.evidence}"`,
          );
      } catch {
        ctx.tracer.emit({
          type: "error",
          stage: "handover_note",
          message: "could not leave the handover brief on the contact",
        });
      }

      ctx.tracer.emit({
        type: "handover",
        trigger: input.trigger,
        evidence: [input.evidence],
      });

      // Kept as episodic context rather than only as a trace event: if the agent is ever turned
      // back on for this conversation, it should know a person was brought in and why.
      ctx.remember({
        kind: "handed_over",
        detail: `a colleague was brought in (${input.trigger}). What they were told: ${input.summary}`,
      });

      return {
        status: "handover",
        reason: input.trigger,
      };
    },
  };
}
