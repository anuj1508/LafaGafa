import type { Guard } from "@harness/core";
import type { UpdateContactInput } from "./index.js";

/**
 * The operator decides which fields the agent may write.
 *
 * Without this, a model that decides `accountBalance` sounds like a field would write one. The
 * allowlist is configuration, so restricting the agent is a settings edit rather than a release.
 */
export const fieldIsWritable: Guard<UpdateContactInput> = {
  name: "field_is_writable",
  check(input, ctx) {
    const allowed = ctx.settings.contactCapture.writableFields;
    if (allowed.includes(input.field)) return { ok: true };
    return {
      ok: false,
      reason: `I'm not able to change ${input.field}. I can note it for the team instead.`,
    };
  },
};

// Deliberately loose. The point is to catch "my email is yes please", not to adjudicate RFC 5322
// or international dialling plans — rejecting a real customer's real address is the worse failure.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[\d\s().-]{7,20}$/;

export const valueLooksValid: Guard<UpdateContactInput> = {
  name: "value_looks_valid",
  check(input) {
    if (input.field === "email" && !EMAIL.test(input.value)) {
      return { ok: false, reason: `"${input.value}" doesn't look like an email address.` };
    }
    if (input.field === "phone" && !PHONE.test(input.value)) {
      return { ok: false, reason: `"${input.value}" doesn't look like a phone number.` };
    }
    return { ok: true };
  },
};
