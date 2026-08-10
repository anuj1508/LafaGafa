import { settingsSchema, type Settings } from "@harness/config";
import { buildSystemPrompt, SkillRegistry, type EpisodicNote, type Session } from "@harness/core";
import { describe, expect, it } from "vitest";

const settings: Settings = settingsSchema.parse({
  businessName: "Northwind Dental",
  locationId: "loc_test",
  timezone: "Europe/London",
  model: {
    chain: [{ provider: "anthropic", model: "m" }],
    gate: { provider: "anthropic", model: "g" },
    judge: { provider: "openai", model: "j" },
  },
});

const NOW = new Date("2026-08-09T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

function promptWith(episodic: EpisodicNote[]): string {
  const session: Session = {
    input: {
      locationId: "loc_test",
      contactId: "con_1",
      conversationId: "conv_1",
      text: "hello",
      history: [],
    },
    settings,
    skills: new SkillRegistry(),
    proceduralDocs: [],
    episodic,
    now: NOW,
  };
  return buildSystemPrompt(session);
}

describe("episodic memory", () => {
  it("presents a recent note as still true", () => {
    const prompt = promptWith([
      {
        kind: "slots_offered",
        at: minutesAgo(2),
        detail: "you offered 08:00",
        staleAfterMinutes: 10,
      },
    ]);

    expect(prompt).toContain("and still true:");
    expect(prompt).toContain("2 minutes ago: you offered 08:00");
    expect(prompt).not.toContain("may have changed:");
  });

  it("marks a note past its own freshness as needing a re-check", () => {
    // The whole point: someone else can take a slot, so an old offer must not be re-quoted.
    const prompt = promptWith([
      {
        kind: "slots_offered",
        at: minutesAgo(45),
        detail: "you offered 08:00",
        staleAfterMinutes: 10,
      },
    ]);

    // Only the bucketing is asserted. What the agent should *do* about a stale note is a
    // judgement call and lives in the skill's own doc, so it is not this test's business.
    expect(prompt).toContain("may have changed:");
    expect(prompt).toContain("45 minutes ago: you offered 08:00");
    expect(prompt).not.toContain("and still true:");
  });

  it("keeps a note with no expiry fresh however old it is", () => {
    // A booking that happened stays happened. Telling a customer otherwise later would be worse
    // than any staleness this avoids.
    const prompt = promptWith([
      { kind: "booked", at: minutesAgo(60 * 20), detail: "you booked 09:00 on Monday" },
    ]);

    expect(prompt).toContain("and still true:");
    expect(prompt).toContain("you booked 09:00 on Monday");
  });

  it("says nothing at all when there is nothing to say", () => {
    const prompt = promptWith([]);

    expect(prompt).not.toContain("Earlier in this conversation");
  });
});

describe("SOUL.md", () => {
  it("substitutes the values it cannot know for itself", () => {
    const session: Session = {
      input: {
        locationId: "loc_test",
        contactId: "con_1",
        conversationId: "conv_1",
        text: "hello",
        history: [],
      },
      settings,
      skills: new SkillRegistry(),
      proceduralDocs: [],
      soul: "You work for {{businessName}}. It is {{now}} in {{timezone}}. Say {{declineMessage}}",
      now: NOW,
    };

    const prompt = buildSystemPrompt(session);

    expect(prompt).toContain("You work for Northwind Dental");
    expect(prompt).toContain("in Europe/London");
    expect(prompt).toContain(settings.safety.declineMessage);
    expect(prompt).not.toContain("{{");
  });

  it("leaves an unknown placeholder visible rather than blanking it", () => {
    // A silently empty placeholder is a prompt with a hole in it that nobody notices.
    const session: Session = {
      input: {
        locationId: "loc_test",
        contactId: "con_1",
        conversationId: "conv_1",
        text: "hello",
        history: [],
      },
      settings,
      skills: new SkillRegistry(),
      proceduralDocs: [],
      soul: "Hello {{nobodyDefinedThis}}",
      now: NOW,
    };

    expect(buildSystemPrompt(session)).toContain("{{nobodyDefinedThis}}");
  });
});
