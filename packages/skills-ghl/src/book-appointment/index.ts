import { formatInZone, type Skill, type SkillContext, type SkillResult } from "@harness/core";
import { GhlApiError } from "@harness/ghl";
import { z } from "zod";
import type { GhlSkillDeps } from "../deps.js";
import { calendarIsAvailable, contactIsIdentified, withinBookingHorizon } from "./guards.js";

const inputSchema = z.object({
  action: z
    .enum(["check_slots", "book"])
    .describe("check_slots to find open times, book to take one the customer has chosen."),
  from: z
    .string()
    .optional()
    .describe("ISO date or datetime to search from. Resolve 'tomorrow' yourself before calling."),
  to: z.string().optional().describe("ISO date or datetime to search until."),
  startTime: z
    .string()
    .optional()
    .describe("For book: the exact slot string as offered, copied not retyped."),
});

export type BookAppointmentInput = z.infer<typeof inputSchema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A slot as a human would say it, in the practice's timezone, with the ISO instant alongside.
 * The model reads the words and copies the identifier. See #precomputed.
 */
function spoken(iso: string, timeZone: string): string {
  return (
    formatInZone(new Date(iso), timeZone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }) ?? iso
  );
}

/** "Tue 11 Aug, 09:00 am [2026-08-11T08:00:00.000Z]" — readable, and unambiguous to book with. */
const labelled = (iso: string, timeZone: string): string => `${spoken(iso, timeZone)} [${iso}]`;

/** The operator's choice wins; otherwise the first active calendar, which suits a single-site business. */
async function resolveCalendarId(
  ctx: SkillContext,
  deps: GhlSkillDeps,
): Promise<string | undefined> {
  if (ctx.settings.booking.calendarId) return ctx.settings.booking.calendarId;
  const calendars = await deps.calendars(ctx.locationId).list();
  return calendars[0]?.id;
}

/**
 * Finds open times and takes one. Two actions rather than two skills: the slots offered must be
 * the slots booked from, and splitting them invites booking a time the model never saw.
 */
export function createBookAppointmentSkill(deps: GhlSkillDeps): Skill<BookAppointmentInput> {
  return {
    name: "book_appointment",
    description:
      "Find open appointment times, or book one the customer has chosen. Call with " +
      "action=check_slots first and offer what comes back; only call action=book with a slot " +
      "the customer picked from those you offered.",
    schema: inputSchema,
    guards: [
      calendarIsAvailable(deps),
      // Only when committing. Answering "what is free on Tuesday" needs nothing from the customer,
      // and demanding a phone number first is the fastest way to lose one.
      { guard: contactIsIdentified(deps), appliesWhen: (input) => input.action === "book" },
      { guard: withinBookingHorizon, appliesWhen: (input) => input.action === "book" },
    ],
    proceduralDoc: "skills/book_appointment/SKILL.md",

    execute(input, ctx) {
      return input.action === "check_slots" ? checkSlots(input, ctx, deps) : book(input, ctx, deps);
    },
  };
}

async function checkSlots(
  input: BookAppointmentInput,
  ctx: SkillContext,
  deps: GhlSkillDeps,
): Promise<SkillResult> {
  const { booking } = ctx.settings;
  const calendarId = await resolveCalendarId(ctx, deps);
  if (!calendarId) return { status: "failed", error: "No calendar available for this location" };

  const from = input.from ? new Date(input.from) : new Date();
  const to = input.to ? new Date(input.to) : new Date(from.getTime() + 7 * DAY_MS);

  const slots = await deps
    .calendars(ctx.locationId)
    .freeSlots({ calendarId, startDate: from, endDate: to });

  if (slots.length === 0) {
    // Empty is a normal answer, not an error. A wider second look costs one call and turns
    // "nothing available" into something the customer can actually act on.
    const widened = await deps.calendars(ctx.locationId).freeSlots({
      calendarId,
      startDate: to,
      endDate: new Date(to.getTime() + booking.horizonDays * DAY_MS),
    });

    ctx.remember({
      kind: "no_slots",
      staleAfterMinutes: booking.slotsFreshMinutes,
      detail: widened[0]
        ? `nothing was free in the range asked for; the next opening was ${widened[0]}`
        : `nothing was free at all within ${booking.horizonDays} days`,
    });
    return {
      status: "ok",
      data: { slots: [], nextAvailable: widened[0] ?? null },
      summaryForModel: widened[0]
        ? `Nothing free in that range. The next opening is ${labelled(widened[0], ctx.settings.timezone)}. Offer it and ask if that suits.`
        : `Nothing free in that range, and nothing in the next ${booking.horizonDays} days either. Offer to pass this to the team.`,
    };
  }

  const offered = slots.slice(0, booking.slotsOffered);
  ctx.remember({
    kind: "slots_offered",
    detail: `you offered these times and no others: ${offered.map((slot) => labelled(slot, ctx.settings.timezone)).join(" · ")}`,
    staleAfterMinutes: booking.slotsFreshMinutes,
  });
  return {
    status: "ok",
    data: { slots: offered },
    summaryForModel:
      `Open times, already in the practice's timezone: ` +
      `${offered.map((slot) => labelled(slot, ctx.settings.timezone)).join(" · ")}. ` +
      `Say the readable part to the customer. Do not convert it, and do not invent others. ` +
      `To book, pass the value in square brackets as startTime.`,
  };
}

async function book(
  input: BookAppointmentInput,
  ctx: SkillContext,
  deps: GhlSkillDeps,
): Promise<SkillResult> {
  const { booking } = ctx.settings;
  const calendarId = await resolveCalendarId(ctx, deps);
  if (!calendarId) return { status: "failed", error: "No calendar available for this location" };
  if (!input.startTime) {
    return { status: "needs_input", ask: "Which of the times offered would the customer like?" };
  }

  const start = new Date(input.startTime);
  const end = new Date(start.getTime() + booking.appointmentMinutes * 60_000);

  // Re-checked immediately before booking because the gap between offering and choosing is
  // exactly when somebody else takes the slot. Losing that race must not double-book.
  const stillFree = await deps.calendars(ctx.locationId).freeSlots({
    calendarId,
    startDate: new Date(start.getTime() - 60_000),
    endDate: end,
  });
  if (!stillFree.some((slot) => new Date(slot).getTime() === start.getTime())) {
    return {
      status: "ok",
      data: { booked: false, reason: "slot_taken", alternatives: stillFree.slice(0, 3) },
      summaryForModel:
        "That slot was taken while you were talking. Say so plainly, then offer fresh times with check_slots.",
    };
  }

  try {
    const appointment = await deps.calendars(ctx.locationId).createAppointment({
      calendarId,
      contactId: ctx.contactId,
      startTime: input.startTime,
      endTime: end.toISOString(),
      title: booking.appointmentTitle,
    });

    // No expiry: a booking that happened stays happened, and telling a customer otherwise later
    // would be worse than any staleness this avoids.
    ctx.remember({
      kind: "booked",
      detail: `you booked an appointment for ${input.startTime}`,
    });
    return {
      status: "ok",
      data: { booked: true, appointmentId: appointment.id, startTime: input.startTime },
      summaryForModel: `Booked for ${input.startTime}. Confirm the time back to the customer.`,
    };
  } catch (error) {
    // A rejection at create time is the same race seen from the other side.
    if (error instanceof GhlApiError && (error.status === 422 || error.status === 409)) {
      await deps
        .contacts(ctx.locationId)
        .update(ctx.contactId, { tags: [booking.failureTag] })
        .catch(() => undefined);
      return {
        status: "ok",
        data: { booked: false, reason: "rejected" },
        summaryForModel:
          "The calendar refused that booking, most likely because the slot went. Offer fresh times.",
      };
    }
    throw error;
  }
}
