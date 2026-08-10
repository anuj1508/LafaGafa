import { SkillRegistry } from "@harness/core";
import { createBookAppointmentSkill } from "./book-appointment/index.js";
import type { GhlSkillDeps } from "./deps.js";
import { createHumanHandoverSkill } from "./human-handover/index.js";
import { createUpdateContactSkill } from "./update-contact/index.js";

export type { GhlSkillDeps } from "./deps.js";

/**
 * The single place skills become available to the agent.
 *
 * This function is the entire integration cost of a new capability: one import and one
 * `.register(...)` line. Nothing in `@harness/core` is edited, which is what makes the claim
 * "adding a skill is registration, not core changes" checkable rather than aspirational.
 */
export function createGhlSkillRegistry(deps: GhlSkillDeps): SkillRegistry {
  return new SkillRegistry()
    .register(createUpdateContactSkill(deps))
    .register(createBookAppointmentSkill(deps))
    .register(createHumanHandoverSkill(deps));
}
