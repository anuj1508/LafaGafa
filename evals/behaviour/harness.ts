import { loadEnv, loadSettings, type ProviderName, type Settings } from "@harness/config";
import {
  ProviderRegistry,
  runTurn,
  Tracer,
  type EpisodicNote,
  type KnowledgeStore,
  type RetrievedChunk,
  type Session,
  type TraceEvent,
  type TraceSink,
  type TurnResult,
} from "@harness/core";
import type { Contact } from "@harness/ghl";
import { createGhlSkillRegistry, type GhlSkillDeps } from "@harness/skills-ghl";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
config({ path: join(ROOT, ".env") });

export const caseSchema = z.object({
  id: z.string(),
  behavior: z.string(),
  history: z.array(z.object({ role: z.enum(["customer", "agent"]), text: z.string() })).default([]),
  input: z.string(),
  expect: z
    .object({
      fired: z.array(z.string()).default([]),
      not_fired: z.array(z.string()).default([]),
      handover: z.boolean().optional(),
      gate: z.enum(["retrieve", "skip"]).optional(),
    })
    .default({}),
  rubric: z.string().optional(),
  must_not_contain: z.array(z.string()).default([]),
  /**
   * Assertions on what was written, not just which skill ran. Recording a husband's address is
   * right; writing it into the contact's own `email` merges two patients into one.
   */
  must_not_write: z.record(z.string(), z.string()).default({}),
});

export type EvalCase = z.infer<typeof caseSchema>;

const suiteSchema = z.object({ suite: z.string(), cases: z.array(caseSchema).min(1) });

export async function loadCases(file: string): Promise<EvalCase[]> {
  const parsed = suiteSchema.parse(parseYaml(await readFile(join(ROOT, file), "utf8")));
  return parsed.cases;
}

/** Set by the runner when a database is available; empty in unit tests. */
let evalSinks: TraceSink[] = [];
export const useEvalSinks = (sinks: TraceSink[]): void => {
  evalSinks = sinks;
};

export const env = loadEnv();
export const settings = await loadSettings(join(ROOT, env.SETTINGS_PATH));
const registry = new ProviderRegistry({
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
});

/**
 * A CRM that records rather than calls, so a failing eval cannot leave real appointments in
 * someone's calendar. What it records is the assertion surface.
 */
function mockCrm(overrides: { contact?: Partial<Contact>; slots?: string[] } = {}) {
  const calls = {
    updates: [] as Array<Record<string, unknown>>,
    appointments: [] as Array<Record<string, unknown>>,
    notes: [] as string[],
    silenced: [] as string[],
  };

  const contact: Contact = {
    id: "con_eval",
    tags: ["anonymous-visitor"],
    ...overrides.contact,
  };
  // Real opening hours across a fortnight, not `now + 3h` — which lands at 1am about a third of the
  // time and made every case about a time of day meaningless, since the agent could only ever offer
  // the middle of the night whatever was asked for.
  const slots = overrides.slots ?? businessHourSlots();

  const deps: GhlSkillDeps = {
    contacts: () =>
      ({
        get: () => Promise.resolve(contact),
        update: (_id: string, patch: Record<string, unknown>) => {
          calls.updates.push(patch);
          return Promise.resolve(contact);
        },
        upsert: (patch: Record<string, unknown>) => {
          calls.updates.push(patch);
          return Promise.resolve({ contact, isNew: false });
        },
        addNote: (_id: string, body: string) => {
          calls.notes.push(body);
          return Promise.resolve();
        },
      }) as unknown as ReturnType<GhlSkillDeps["contacts"]>,
    calendars: () =>
      ({
        list: () => Promise.resolve([{ id: "cal_eval", name: "Evals", isActive: true }]),
        // Honours the requested window. A mock that returns the same three times whatever it is
        // asked for cannot fail a case about respecting a range, which is most of what booking
        // has to get right.
        freeSlots: (input: { startDate: Date; endDate: Date }) =>
          Promise.resolve(
            slots.filter((slot) => {
              const at = new Date(slot).getTime();
              return at >= input.startDate.getTime() && at <= input.endDate.getTime();
            }),
          ),
        createAppointment: (input: Record<string, unknown>) => {
          calls.appointments.push(input);
          return Promise.resolve({ id: "appt_eval" });
        },
      }) as unknown as ReturnType<GhlSkillDeps["calendars"]>,
    conversations: () => ({}) as unknown as ReturnType<GhlSkillDeps["conversations"]>,
    silenceAgent: ({ reason }) => {
      calls.silenced.push(reason);
      return Promise.resolve();
    },
  };

  return { deps, calls };
}

/**
 * How far the named timezone is from UTC at a given instant. `Intl` formats into a zone but will
 * not parse out of one, so the offset is recovered by formatting and reading the parts back.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts["year"]),
    Number(parts["month"]) - 1,
    Number(parts["day"]),
    Number(parts["hour"]) === 24 ? 0 : Number(parts["hour"]),
    Number(parts["minute"]),
    Number(parts["second"]),
  );
  return asUtc - instant.getTime();
}

/**
 * 9:00, 11:30, 15:00 and 17:30 across the next fortnight, in the practice's timezone — two either
 * side of midday, deep enough for "next week". Built in the business's zone, never the machine's.
 */
function businessHourSlots(): string[] {
  const zone = settings.timezone;
  const times = [
    [9, 0],
    [11, 30],
    [15, 0],
    [17, 30],
  ];
  return Array.from({ length: 14 }).flatMap((_, dayOffset) => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + dayOffset + 1);
    return times.map(([hour, minute]) => {
      const wallClock = Date.UTC(
        day.getUTCFullYear(),
        day.getUTCMonth(),
        day.getUTCDate(),
        hour ?? 9,
        minute ?? 0,
      );
      return new Date(wallClock - offsetAt(new Date(wallClock), zone)).toISOString();
    });
  });
}

interface RunOutcome {
  turnId: string;
  result: TurnResult;
  events: readonly TraceEvent[];
  calls: ReturnType<typeof mockCrm>["calls"];
  fired: string[];
  gate: string | null;
  retrieved: RetrievedChunk[];
}

/**
 * Replays one case through the real loop, skills, guards and prompts. Only the CRM is substituted:
 * a suite that also stubbed the loop would be testing its own fixtures.
 */
export async function runCase(
  testCase: EvalCase,
  provider: ProviderName,
  knowledge: KnowledgeStore | undefined,
  soul: string,
  proceduralDocs: string[],
): Promise<RunOutcome> {
  const binding = settings.model.chain.find((entry) => entry.provider === provider);
  if (!binding) throw new Error(`No model configured for provider "${provider}"`);

  const crm = mockCrm();
  const turnId = randomUUID();

  // The judge has to check claims against the text the agent actually saw, and `ground()` returns
  // a new session rather than mutating the one passed in, so reading `session.retrieved` here gets
  // nothing. Observing at the port is both correct and free of any production change: this is the
  // store, so it knows what it returned.
  const seen: RetrievedChunk[] = [];
  const recording: KnowledgeStore | undefined = knowledge
    ? {
        search: async (input) => {
          const chunks = await knowledge.search(input);
          seen.push(...chunks);
          return chunks;
        },
      }
    : undefined;
  /**
   * Eval turns write their trace like any other turn, so a regression is a turn you can open and
   * watch in the production viewer rather than a line of text. See #eval-traces.
   */
  const tracer = new Tracer({
    turnId,
    conversationId: `eval:${testCase.id}`,
    agentId: testCase.id,
    source: "eval",
    sinks: evalSinks,
  });
  const learned: EpisodicNote[] = [];

  const scopedSettings: Settings = {
    ...settings,
    model: {
      ...settings.model,
      chain: [binding],
      // The gate runs on the provider under test: otherwise a "google" row measures Google's chat
      // with Anthropic's gate. Shape held constant so the comparison is of the model.
      gate: {
        ...binding,
        temperature: 0,
        maxOutputTokens: settings.model.gate.maxOutputTokens,
        timeoutMs: settings.model.gate.timeoutMs,
      },
    },
    // One iteration less than production: a case that needs six steps is a case whose behaviour
    // is too tangled to assert on anyway.
    behavior: { ...settings.behavior, maxIterations: 4 },
  };

  const session: Session = {
    input: {
      locationId: settings.locationId,
      contactId: "con_eval",
      conversationId: "eval",
      text: testCase.input,
      history: testCase.history.map((turn) => ({
        role: turn.role === "customer" ? ("user" as const) : ("assistant" as const),
        content: turn.text,
      })),
    },
    settings: scopedSettings,
    skills: createGhlSkillRegistry(crm.deps),
    proceduralDocs,
    soul,
    ...(recording ? { knowledge: recording } : {}),
  };

  const result = await runTurn(session, registry, tracer, {
    locationId: settings.locationId,
    contactId: "con_eval",
    conversationId: "eval",
    settings: scopedSettings,
    tracer,
    remember: (note) => learned.push({ ...note, at: new Date().toISOString() }),
  });

  // Both the skill and, where it has one, `skill:action` — a fixture that can only say
  // "book_appointment fired" cannot express "looking is fine, booking is not".
  const fired = tracer.events.flatMap((event) => {
    if (event.type !== "tool_call") return [];
    const action = (event.args as { action?: unknown } | null)?.action;
    return typeof action === "string" ? [event.skill, `${event.skill}:${action}`] : [event.skill];
  });
  const gateEvent = tracer.events.find((event) => event.type === "gate");
  const ragEvent = tracer.events.find((event) => event.type === "rag_retrieve");

  await tracer.flush();

  return {
    turnId,
    result,
    events: tracer.events,
    calls: crm.calls,
    fired,
    gate: gateEvent?.type === "gate" ? gateEvent.decision : null,
    // The trace records every candidate including the rejected ones, so filter by the floor rather
    // than by the event: only what cleared it reached the prompt, and only that may be grounded in.
    retrieved:
      ragEvent === undefined
        ? []
        : seen.filter((chunk) => chunk.score >= settings.knowledge.relevanceFloor),
  };
}

export async function loadPrompts(): Promise<{ soul: string; proceduralDocs: string[] }> {
  const soul = await readFile(join(ROOT, settings.soulPath), "utf8");
  const docs = await Promise.all(
    ["update_contact", "book_appointment", "human_handover"].map((name) =>
      readFile(join(ROOT, "skills", name, "SKILL.md"), "utf8"),
    ),
  );
  return { soul, proceduralDocs: docs };
}
