import { callModel, ProviderRegistry, Tracer } from "@harness/core";
import { z } from "zod";
import { env, loadCases, settings } from "../behaviour/harness.js";

/* eslint-disable no-console -- this command's output is its report */

/**
 * Second-guesses the fixtures, not the agent: was what we asserted actually right. Advisory only —
 * it prints disagreements for a human to settle. Flag: --id. See #fixture-review.
 */

const verdictSchema = z.object({
  agrees: z.boolean(),
  argument: z.string().default(""),
  suggestion: z.string().default(""),
});

const args = process.argv.slice(2);
const only = args.includes("--id") ? args[args.indexOf("--id") + 1] : undefined;

const registry = new ProviderRegistry({
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const cases = (await loadCases("evals/fixtures/behaviour.yaml")).filter(
  (entry) => !only || entry.id === only,
);

console.log(`\nReviewing ${String(cases.length)} fixtures against ${settings.model.judge.model}`);
console.log("Flags disagreement for a human to settle. It does not decide.\n");

const disputed: Array<{ id: string; argument: string; suggestion: string }> = [];

for (const testCase of cases) {
  const expectation = [
    testCase.expect.fired.length > 0 ? `must call: ${testCase.expect.fired.join(", ")}` : "",
    testCase.expect.not_fired.length > 0
      ? `must NOT call: ${testCase.expect.not_fired.join(", ")}`
      : "",
    testCase.expect.gate ? `retrieval must ${testCase.expect.gate}` : "",
    testCase.expect.handover !== undefined
      ? `must ${testCase.expect.handover ? "" : "not "}hand over to a human`
      : "",
    Object.entries(testCase.must_not_write)
      .map(([field, value]) => `must NOT write ${field}=${value}`)
      .join(", "),
    testCase.rubric ? `judged on: ${testCase.rubric}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const tracer = new Tracer({
    turnId: "00000000-0000-0000-0000-000000000000",
    conversationId: "review",
    sinks: [],
  });

  const verdict = await callModel(
    {
      role: "judge",
      chain: [settings.model.judge],
      system: [
        "You are reviewing one test case for an AI receptionist at Northwind Dental, a private UK dental practice. You are NOT judging the agent's reply — you are judging whether the expectation this test asserts is the right thing to want.",
        "",
        "WHAT THE AGENT CAN ACTUALLY DO. Nothing outside this list exists, so never suggest it.",
        "",
        "1. update_contact(field, value, confirmed)",
        "   - Writes ONE field per call onto the customer's CRM contact.",
        "   - Real CRM fields: firstName, lastName, email, phone.",
        "   - email and phone must be read back and confirmed by the customer before saving.",
        "   - The CRM deduplicates on email and phone: writing a value that belongs to somebody else can merge two patients into one record.",
        "   - correspondenceEmail is allowed and is stored as a note, for an address the customer gives that is not their own.",
        "   - It cannot store arbitrary fields. There is no preferences field, no budget field, no notes-by-topic.",
        "",
        "2. book_appointment(action, from, to, slot)",
        "   - action: check_slots finds open times in a date range; book takes one the customer has chosen.",
        "   - It can only offer times the calendar returned. It never invents a slot.",
        "   - It needs an email or a phone on the contact before it will book, asked for once a time is chosen.",
        "   - It CANNOT cancel, reschedule, or move an existing appointment. It cannot look up what someone has already booked. Those go to a human.",
        "",
        "3. human_handover(trigger, evidence)",
        "   - Stops the agent in that conversation and briefs the team. Triggers: explicit_request, frustration, out_of_scope, repeated_failure.",
        "",
        "4. Answering questions. The agent retrieves passages from the practice's own documents and answers only from them. When nothing relevant is found it declines and offers a person. It never invents a price, a policy, or clinical advice. A retrieval gate decides per turn whether to search at all, so greetings and mid-action replies skip it.",
        "",
        "WHAT IT MUST NEVER DO: give clinical or diagnostic advice, quote a figure not in the documents, promise or refuse a refund, claim an action a tool did not confirm, or narrate its own record-keeping.",
        "",
        "HOW TO READ AN ASSERTION.",
        '"must call: book_appointment" means the skill was invoked at all — check_slots satisfies it. It does NOT mean the agent booked anything. Where a case cares about the difference it says so explicitly, as book_appointment:check_slots or book_appointment:book. Do not object that the agent should check slots first; that is what the assertion already allows.',
        '"must call: update_contact" means one field was written. Only email and phone require the customer to confirm the value first; a first name does not.',
        "An assertion lists what must and must not happen. It is not a script, and it does not forbid the agent doing sensible things it does not mention.",
        "",
        "HOW TO JUDGE THE EXPECTATION.",
        "Argue the opposite case honestly before answering. Ask: would a good receptionist do this? Is a customer worse off if the agent behaves as asserted? Is the assertion demanding something the agent cannot do?",
        "Two principles this build follows, so do not flag them as faults: act on information rather than filing it when an action exists; and record something only when nothing can act on it.",
        "Most expectations are fine — say so. Disagree only when you can name a concrete customer who would be worse off, or a capability being demanded that does not exist.",
        'Reply with JSON only: {"agrees":true|false,"argument":"one sentence","suggestion":"what the expectation should be instead, or empty"}',
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            testCase.history.length > 0
              ? `Earlier in the conversation:\n${testCase.history.map((turn) => `${turn.role}: ${turn.text}`).join("\n")}`
              : "",
            `Customer says: ${testCase.input}`,
            `The test asserts:\n${expectation}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    },
    registry,
    tracer,
  );

  const parsed = verdictSchema.safeParse(JSON.parse(extractJson(verdict.text)));
  if (parsed.success && !parsed.data.agrees) {
    disputed.push({
      id: testCase.id,
      argument: parsed.data.argument,
      suggestion: parsed.data.suggestion,
    });
  }
  process.stdout.write(parsed.success && parsed.data.agrees ? "." : "?");
}

console.log("\n");

if (disputed.length === 0) {
  console.log("No fixture was disputed.");
} else {
  console.log(`${String(disputed.length)} fixtures worth a second look:\n`);
  for (const entry of disputed) {
    console.log(`  ${entry.id}`);
    console.log(`    ${entry.argument}`);
    if (entry.suggestion) console.log(`    suggests: ${entry.suggestion}`);
    console.log("");
  }
}

// Never fails the build. A disagreement is a conversation to have, not a broken test.
console.log("Advisory only — nothing here is a failure.");

/** Models wrap JSON in prose or fences often enough that trusting the raw string is a bug. */
function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text.trim();
}
