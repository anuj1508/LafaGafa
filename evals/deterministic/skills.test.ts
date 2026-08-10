import { settingsSchema, type Settings } from "@harness/config";
import { guardsFor, Tracer, type Skill, type SkillContext, type SkillResult } from "@harness/core";
import type { Contact } from "@harness/ghl";
import { createGhlSkillRegistry, type GhlSkillDeps } from "@harness/skills-ghl";
import { beforeEach, describe, expect, it } from "vitest";

const baseSettings: Settings = settingsSchema.parse({
  businessName: "Northwind Dental",
  locationId: "loc_test",
  model: {
    chain: [{ provider: "anthropic", model: "m" }],
    gate: { provider: "anthropic", model: "g" },
    judge: { provider: "openai", model: "j" },
  },
  booking: { calendarId: "cal_1", appointmentMinutes: 30, slotsOffered: 3, minNoticeMinutes: 60 },
});

/**
 * A CRM that records what it was asked to do.
 *
 * Every assertion below is about the call the skill made, not about a reply's wording — a skill
 * that says it saved an email but never called the CRM is precisely the failure worth catching.
 */
function fakeGhl() {
  const calls = {
    updates: [] as Array<{ contactId: string; patch: Record<string, unknown> }>,
    appointments: [] as Array<Record<string, unknown>>,
    silenced: [] as Array<{ conversationId: string; reason: string }>,
    notes: [] as Array<{ contactId: string; body: string }>,
  };
  let contact: Contact = { id: "con_1", tags: [] };
  let slots: string[] = [];
  let upsertSurvivor: Partial<Contact> = {};

  const deps: GhlSkillDeps = {
    contacts: () =>
      ({
        get: () => Promise.resolve(contact),
        update: (contactId: string, patch: Record<string, unknown>) => {
          calls.updates.push({ contactId, patch });
          return Promise.resolve(contact);
        },
        addNote: (contactId: string, body: string) => {
          calls.notes.push({ contactId, body });
          return Promise.resolve();
        },
        upsert: (patch: Record<string, unknown>) => {
          calls.updates.push({ contactId: contact.id, patch });
          return Promise.resolve({ contact: { ...contact, ...upsertSurvivor }, isNew: false });
        },
      }) as unknown as ReturnType<GhlSkillDeps["contacts"]>,
    calendars: () =>
      ({
        freeSlots: () => Promise.resolve(slots),
        createAppointment: (input: Record<string, unknown>) => {
          calls.appointments.push(input);
          return Promise.resolve({ id: "appt_1" });
        },
      }) as unknown as ReturnType<GhlSkillDeps["calendars"]>,
    conversations: () => ({}) as unknown as ReturnType<GhlSkillDeps["conversations"]>,
    silenceAgent: ({ conversationId, reason }) => {
      calls.silenced.push({ conversationId, reason });
      return Promise.resolve();
    },
  };

  return {
    deps,
    calls,
    setContact: (next: Partial<Contact>) => {
      contact = { ...contact, ...next };
    },
    setSlots: (next: string[]) => {
      slots = next;
    },
    /** Simulates GHL folding this contact into an existing one with the same email. */
    setMergeTarget: (id: string) => {
      upsertSurvivor = { id };
    },
  };
}

let ghl: ReturnType<typeof fakeGhl>;
let settings: Settings;

function skill(name: string): Skill<never> {
  const found = createGhlSkillRegistry(ghl.deps).get(name);
  if (!found) throw new Error(`no skill named ${name}`);
  return found;
}

const remembered: Array<{ kind: string; detail: string }> = [];

function ctx(): SkillContext {
  return {
    locationId: "loc_test",
    contactId: "con_1",
    conversationId: "conv_1",
    settings,
    tracer: new Tracer({ turnId: "t", conversationId: "conv_1", sinks: [] }),
    remember: (note) => remembered.push(note),
  };
}

/** Uses the loop's own guard selection rather than mirroring it, so the two cannot drift. */
async function invoke(name: string, input: unknown): Promise<SkillResult> {
  const target = skill(name);
  const parsed = target.schema.safeParse(input);
  if (!parsed.success) return { status: "failed", error: parsed.error.message };

  for (const guard of guardsFor(target, parsed.data)) {
    const verdict = await guard.check(parsed.data, ctx());
    if (!verdict.ok) return { status: "blocked", reason: verdict.reason };
  }
  return target.execute(parsed.data, ctx());
}

beforeEach(() => {
  ghl = fakeGhl();
  settings = baseSettings;
});

describe("update_contact", () => {
  it("saves a field the operator allows", async () => {
    const result = await invoke("update_contact", {
      field: "firstName",
      value: "Priya",
      confirmed: true,
    });

    expect(result.status).toBe("ok");
    expect(ghl.calls.updates).toEqual([{ contactId: "con_1", patch: { firstName: "Priya" } }]);
  });

  it("does NOT write a field outside the allowlist", async () => {
    settings = {
      ...baseSettings,
      contactCapture: { ...baseSettings.contactCapture, writableFields: ["firstName"] },
    };

    const result = await invoke("update_contact", { field: "email", value: "a@b.com" });

    expect(result.status).toBe("blocked");
    expect(ghl.calls.updates).toHaveLength(0);
  });

  it("does NOT write an email that is not one", async () => {
    const result = await invoke("update_contact", {
      field: "email",
      value: "yes please",
      confirmed: true,
    });

    expect(result.status).toBe("blocked");
    expect(ghl.calls.updates).toHaveLength(0);
  });

  it("asks for confirmation before writing an identity field", async () => {
    const result = await invoke("update_contact", { field: "email", value: "priya@example.com" });

    expect(result.status).toBe("needs_input");
    expect(ghl.calls.updates).toHaveLength(0);
  });

  it("reports the surviving contact when the CRM merges this one away", async () => {
    // GHL deduplicates on email: writing one that already exists destroys the id we hold, and
    // every later call for it fails unless the turn learns which record won.
    ghl.setContact({ tags: ["anonymous-visitor"] });
    ghl.setMergeTarget("con_existing");

    const result = await invoke("update_contact", {
      field: "email",
      value: "priya@example.com",
      confirmed: true,
    });

    expect(result).toMatchObject({
      status: "ok",
      data: { mergedIntoContactId: "con_existing" },
    });
  });

  it("does NOT overwrite a value already on the record when the operator forbids it", async () => {
    ghl.setContact({ email: "old@example.com" });

    const result = await invoke("update_contact", {
      field: "email",
      value: "new@example.com",
      confirmed: true,
    });

    expect(result.status).toBe("blocked");
    expect(ghl.calls.updates).toHaveLength(0);
  });
});

describe("book_appointment", () => {
  const soon = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  it("answers an availability question for a visitor with no contact details", async () => {
    // Looking at a calendar reveals nothing about anyone. Demanding an email before saying
    // whether 8:30 is free turns a question into a form.
    ghl.setSlots([soon()]);

    const result = await invoke("book_appointment", { action: "check_slots" });

    expect(result.status).toBe("ok");
    expect(ghl.calls.appointments).toHaveLength(0);
  });

  it("does NOT book for a contact with no email and no phone", async () => {
    ghl.setSlots([soon()]);

    const result = await invoke("book_appointment", { action: "book", startTime: soon() });

    expect(result.status).toBe("blocked");
    expect(ghl.calls.appointments).toHaveLength(0);
  });

  it("treats no availability as an answer, not a failure", async () => {
    ghl.setContact({ email: "priya@example.com" });
    ghl.setSlots([]);

    const result = await invoke("book_appointment", { action: "check_slots" });

    expect(result.status).toBe("ok");
    expect(ghl.calls.appointments).toHaveLength(0);
  });

  it("books a slot that is still free", async () => {
    const slot = soon();
    ghl.setContact({ email: "priya@example.com" });
    ghl.setSlots([slot]);

    const result = await invoke("book_appointment", { action: "book", startTime: slot });

    expect(result.status).toBe("ok");
    expect(ghl.calls.appointments).toHaveLength(1);
    expect(ghl.calls.appointments[0]).toMatchObject({ calendarId: "cal_1", startTime: slot });
  });

  it("does NOT double-book when the slot went while the customer was choosing", async () => {
    const slot = soon();
    ghl.setContact({ email: "priya@example.com" });
    // The re-check returns a different time, which is what losing the race looks like.
    ghl.setSlots([new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()]);

    const result = await invoke("book_appointment", { action: "book", startTime: slot });

    expect(result.status).toBe("ok");
    expect(result).toMatchObject({ data: { booked: false, reason: "slot_taken" } });
    expect(ghl.calls.appointments).toHaveLength(0);
  });

  it("does NOT book inside the notice period", async () => {
    ghl.setContact({ email: "priya@example.com" });
    const tooSoon = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const result = await invoke("book_appointment", { action: "book", startTime: tooSoon });

    expect(result.status).toBe("blocked");
    expect(ghl.calls.appointments).toHaveLength(0);
  });
});

describe("human_handover", () => {
  it("silences the agent before anything else can fail", async () => {
    const result = await invoke("human_handover", {
      trigger: "explicit_request",
      evidence: "get me a human",
      summary: "Wants to talk to a person about a refund. Nothing booked.",
    });

    expect(result.status).toBe("handover");
    expect(ghl.calls.silenced).toEqual([{ conversationId: "conv_1", reason: "explicit_request" }]);
    expect(ghl.calls.updates[0]?.patch).toMatchObject({ tags: baseSettings.handover.tags });
  });

  it("does NOT hand over on a trigger the operator switched off", async () => {
    settings = {
      ...baseSettings,
      handover: {
        ...baseSettings.handover,
        triggers: { ...baseSettings.handover.triggers, frustration: false },
      },
    };

    const result = await invoke("human_handover", {
      trigger: "frustration",
      evidence: "this is useless",
      summary: "Repeated the same question three times.",
    });

    expect(result.status).toBe("blocked");
    expect(ghl.calls.silenced).toHaveLength(0);
  });

  it("leaves a brief on the contact so a colleague can pick it up cold", async () => {
    // Being made to tell the whole story again is most of what makes a handover feel like a
    // failure, and the tag alone carries none of it.
    await invoke("human_handover", {
      trigger: "out_of_scope",
      evidence: "is this reversible?",
      summary: "Thinning at the crown, minoxidil for six months with no change.",
    });

    expect(ghl.calls.notes).toHaveLength(1);
    expect(ghl.calls.notes[0]?.body).toContain("minoxidil for six months");
  });

  it("assigns an owner when the operator configured one", async () => {
    settings = {
      ...baseSettings,
      handover: { ...baseSettings.handover, assignTo: "user_42" },
    };

    await invoke("human_handover", {
      trigger: "explicit_request",
      evidence: "a person please",
      summary: "Asked for a person straight away.",
    });

    expect(ghl.calls.updates[0]?.patch).toMatchObject({ assignedTo: "user_42" });
  });
});
