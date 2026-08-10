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

/** The fields GHL deduplicates contacts on. Writing one can merge this contact into another. */
const DEDUPING_FIELDS = new Set(["email", "phone"]);

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

      // Writing an email or phone can fold this contact into an existing one with the same
      // value, destroying the id we hold. Upsert is the only call that reports which record
      // survived, so the rest of the turn keeps talking to a contact that still exists.
      if (DEDUPING_FIELDS.has(input.field)) {
        const { contact } = await deps
          .contacts(ctx.locationId)
          .upsert({ ...patch, [input.field]: input.value });

        if (contact.id !== ctx.contactId) {
          ctx.tracer.emit({
            type: "crm_call",
            method: "MERGE",
            path: `/contacts/${ctx.contactId} -> /contacts/${contact.id}`,
            status: 200,
            latencyMs: 0,
          });
          return {
            status: "ok",
            data: { field: input.field, value: input.value, mergedIntoContactId: contact.id },
            summaryForModel: `Saved ${input.field} as "${input.value}". This customer already had a record here and the two have been merged.`,
          };
        }

        return {
          status: "ok",
          data: { field: input.field, value: input.value },
          summaryForModel: `Saved ${input.field} as "${input.value}" on the contact record.`,
        };
      }

      await deps.contacts(ctx.locationId).update(ctx.contactId, patch);

      return {
        status: "ok",
        data: { field: input.field, value: input.value },
        summaryForModel: `Saved ${input.field} as "${input.value}" on the contact record.`,
      };
    },
  };
}
