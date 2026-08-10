import type { Guard } from "@harness/core";
import type { GhlSkillDeps } from "../deps.js";
import type { BookAppointmentInput } from "./index.js";

/** A booking needs somewhere to go. Fails only when the location genuinely has no calendar. */
export function calendarIsAvailable(deps: GhlSkillDeps): Guard<BookAppointmentInput> {
  return {
    name: "calendar_is_available",
    async check(_input, ctx) {
      if (ctx.settings.booking.calendarId) return { ok: true };
      const calendars = await deps.calendars(ctx.locationId).list();
      if (calendars.length > 0) return { ok: true };
      return {
        ok: false,
        reason: "This business has no bookable calendar, so offer to pass this to the team.",
      };
    },
  };
}

/**
 * A booking must belong to someone reachable. Scoped to booking, never to looking — see #guards.
 * The failure reason names what to collect, which chains it into `update_contact`.
 */
export function contactIsIdentified(deps: GhlSkillDeps): Guard<BookAppointmentInput> {
  return {
    name: "contact_is_identified",
    async check(_input, ctx) {
      const contact = await deps.contacts(ctx.locationId).get(ctx.contactId);
      const hasEmail = (contact.email ?? "").trim().length > 0;
      const hasPhone = (contact.phone ?? "").trim().length > 0;
      if (hasEmail || hasPhone) return { ok: true };
      return {
        ok: false,
        reason:
          "Before booking, get the customer's email address or phone number and save it with update_contact.",
      };
    },
  };
}

/**
 * Bookings stay inside the window the operator opened.
 *
 * `minNoticeMinutes` stops an appointment being booked for three minutes from now, and
 * `horizonDays` stops one being booked for next year.
 */
export const withinBookingHorizon: Guard<BookAppointmentInput> = {
  name: "within_booking_horizon",
  check(input, ctx) {
    // The action check lives where the guard is declared; only the missing-time case is left.
    if (!input.startTime) return { ok: true };

    const start = new Date(input.startTime);
    if (Number.isNaN(start.getTime())) {
      return { ok: false, reason: `"${input.startTime}" is not a time I can read.` };
    }

    const { minNoticeMinutes, horizonDays } = ctx.settings.booking;
    const minutesAway = (start.getTime() - Date.now()) / 60_000;

    if (minutesAway < minNoticeMinutes) {
      return {
        ok: false,
        reason: `That is too soon — this business needs at least ${minNoticeMinutes} minutes' notice. Offer a later slot.`,
      };
    }
    if (minutesAway / (60 * 24) > horizonDays) {
      return {
        ok: false,
        reason: `That is further ahead than this business takes bookings (${horizonDays} days). Offer something sooner.`,
      };
    }
    return { ok: true };
  },
};
