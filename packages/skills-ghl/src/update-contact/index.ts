import type { Skill } from "@harness/core";
import { z } from "zod";
import type { GhlSkillDeps } from "../deps.js";
import { fieldIsWritable, valueLooksValid } from "./guards.js";

const inputSchema = z.object({
  field: z
    .string()
    .describe("The contact field to set, e.g. firstName, lastName, email, phone, budget."),
  value: z.string().min(1).describe("The value exactly as the customer gave it. Never inferred."),
  confirmed: z
    .boolean()
    .default(false)
    .describe("True only after the customer has confirmed this exact value back to you."),
});

export type UpdateContactInput = z.infer<typeof inputSchema>;

/** Standard GHL fields; anything else in the allowlist is treated as a custom field. */
const STANDARD_FIELDS = new Set(["firstName", "lastName", "email", "phone"]);

/**
 * Writes a detail the customer volunteered. The interesting behaviour is what it refuses:
 * unallowed fields, malformed values, and unconfirmed identity. See #guards.
 */
export function createUpdateContactSkill(deps: GhlSkillDeps): Skill<UpdateContactInput> {
  return {
    name: "update_contact",
    description:
      "Record a detail the customer has just given you about themselves — their name, email, " +
      "phone, budget or preferred time — onto their contact record. Use only for details they " +
      "stated. Never guess, never infer from context, and never use this to look anything up.",
    schema: inputSchema,
    guards: [fieldIsWritable, valueLooksValid],
    proceduralDoc: "skills/update_contact/SKILL.md",

    async execute(input, ctx) {
      const needsConfirming = ctx.settings.contactCapture.confirmBeforeWrite.includes(input.field);
      if (needsConfirming && !input.confirmed) {
        return {
          status: "needs_input",
          ask: `Read the ${input.field} back to the customer and ask them to confirm it before saving.`,
        };
      }

      if (!ctx.settings.contactCapture.overwriteExisting && STANDARD_FIELDS.has(input.field)) {
        const existing = await deps.contacts(ctx.locationId).get(ctx.contactId);
        // A contact still carrying the placeholder tag has nothing worth protecting: every value
        // on it was invented by us, so overwriting is the whole point rather than a risk.
        const isPlaceholder = existing.tags.includes(ctx.settings.contactCapture.placeholderTag);
        const current = existing[input.field as "firstName" | "lastName" | "email" | "phone"];
        if (
          !isPlaceholder &&
          typeof current === "string" &&
          current.trim().length > 0 &&
          current !== input.value
        ) {
          return {
            status: "blocked",
            reason: `${input.field} is already recorded as "${current}" and this business does not allow the assistant to overwrite it. Offer to pass the change to the team.`,
          };
        }
      }

      // Non-standard fields become a note: custom fields need a scope we do not hold, and would
      // fail silently. See docs/architecture.md#record-vs-act.
      if (!STANDARD_FIELDS.has(input.field)) {
        await deps
          .contacts(ctx.locationId)
          .addNote(ctx.contactId, `${input.field}: ${input.value}`);
        return {
          status: "ok",
          data: { field: input.field, value: input.value, storedAs: "note" },
          summaryForModel: `Noted ${input.field} as "${input.value}" on the contact record.`,
        };
      }

      const patch = { [input.field]: input.value };

      // Every field is written straight to the contact we were given, email and phone included.
      // Merge handling is deliberately absent for now: see docs/architecture.md#contact-merge.
      await deps.contacts(ctx.locationId).update(ctx.contactId, patch);

      return {
        status: "ok",
        data: { field: input.field, value: input.value },
        summaryForModel: `Saved ${input.field} as "${input.value}" on the contact record.`,
      };
    },
  };
}
