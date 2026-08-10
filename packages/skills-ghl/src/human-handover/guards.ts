import type { Guard } from "@harness/core";
import type { HumanHandoverInput } from "./index.js";

/**
 * An operator can switch off individual reasons for handing over.
 *
 * A lead-gen client may want frustration handled by the agent and only explicit asks escalated;
 * a medical client wants the opposite. Both are the same build with different settings, and a
 * disabled trigger tells the model why so it can keep helping instead of going quiet.
 */
export const triggerIsEnabled: Guard<HumanHandoverInput> = {
  name: "trigger_is_enabled",
  check(input, ctx) {
    const { triggers } = ctx.settings.handover;
    const enabled: Record<HumanHandoverInput["trigger"], boolean> = {
      explicit_request: triggers.explicitRequest,
      frustration: triggers.frustration,
      out_of_scope: triggers.outOfScope,
      repeated_failure: triggers.repeatedFailure,
    };

    if (enabled[input.trigger]) return { ok: true };
    return {
      ok: false,
      reason: `This business does not hand over for "${input.trigger}". Keep helping, and only escalate if they ask for a person directly.`,
    };
  },
};
