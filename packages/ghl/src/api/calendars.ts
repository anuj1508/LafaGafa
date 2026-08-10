import { z } from "zod";
import type { GhlClient } from "../client.js";

const VERSION = "2021-04-15";

/**
 * Free slots come back keyed by date, with a `traceId` sibling that is not a date.
 *
 * Modelled as a permissive record and filtered rather than parsed strictly: a response whose
 * shape shifts slightly should cost us one unusable day, not the whole booking flow.
 */
const freeSlotsResponseSchema = z.record(
  z.string(),
  z.union([z.object({ slots: z.array(z.string()).default([]) }), z.unknown()]),
);

const calendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  isActive: z.boolean().optional(),
  description: z.string().optional(),
  calendarType: z.string().optional(),
});

type Calendar = z.infer<typeof calendarSchema>;

const listCalendarsResponseSchema = z.object({
  calendars: z.array(calendarSchema).default([]),
});

const appointmentSchema = z.object({
  id: z.string(),
  calendarId: z.string().optional(),
  contactId: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  appointmentStatus: z.string().optional(),
});

export type Appointment = z.infer<typeof appointmentSchema>;

const createAppointmentResponseSchema = z.union([
  appointmentSchema,
  z.object({ event: appointmentSchema }).transform((value) => value.event),
]);

export interface CreateAppointmentInput {
  calendarId: string;
  contactId: string;
  /** ISO 8601 with offset. The offset is what pins the slot to a real moment. */
  startTime: string;
  endTime?: string;
  title?: string;
}

export class CalendarsApi {
  constructor(
    private readonly client: GhlClient,
    private readonly locationId: string,
  ) {}

  /**
   * The bookable calendars for this location, active ones only.
   *
   * Discovery rather than configuration: an operator should not have to paste an id out of a URL
   * before the agent can book anything, and a location that adds a calendar should not need a
   * settings edit for the agent to see it.
   */
  async list(): Promise<Calendar[]> {
    const response = await this.client.requests(this.locationId).get("/calendars/", {
      params: { locationId: this.locationId },
      headers: { Version: VERSION },
    });

    return listCalendarsResponseSchema
      .parse(response.data)
      .calendars.filter((calendar) => calendar.isActive !== false);
  }

  /**
   * Open slots between two instants, flattened and sorted.
   *
   * Returned as ISO strings carrying their offset rather than as Date objects: the customer is
   * told a wall-clock time in the business's timezone, and converting through a local Date is
   * how an agent ends up offering 3am.
   */
  async freeSlots(input: {
    calendarId: string;
    startDate: Date;
    endDate: Date;
    timezone?: string;
  }): Promise<string[]> {
    const response = await this.client
      .requests(this.locationId)
      .get(`/calendars/${input.calendarId}/free-slots`, {
        params: {
          startDate: input.startDate.getTime(),
          endDate: input.endDate.getTime(),
          ...(input.timezone ? { timezone: input.timezone } : {}),
        },
        headers: { Version: VERSION },
      });

    const parsed = freeSlotsResponseSchema.parse(response.data);
    return Object.entries(parsed)
      .filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key))
      .flatMap(([, day]) =>
        day !== null && typeof day === "object" && "slots" in day ? (day.slots as string[]) : [],
      )
      .sort();
  }

  async createAppointment(input: CreateAppointmentInput): Promise<Appointment> {
    const response = await this.client.requests(this.locationId).post(
      "/calendars/events/appointments",
      {
        locationId: this.locationId,
        calendarId: input.calendarId,
        contactId: input.contactId,
        startTime: input.startTime,
        ...(input.endTime ? { endTime: input.endTime } : {}),
        ...(input.title ? { title: input.title } : {}),
      },
      { headers: { Version: VERSION } },
    );
    return createAppointmentResponseSchema.parse(response.data);
  }
}
