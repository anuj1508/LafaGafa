import { z } from "zod";

/** Operator settings: every field is a value someone changes and restarts, never a code change. */

export const providerNameSchema = z.enum(["anthropic", "openai", "google"]);
export type ProviderName = z.infer<typeof providerNameSchema>;

/**
 * Channels the harness can both receive on and reply on — an intersection, not everything GHL
 * supports. GMB arrives on the webhook but cannot be replied to, so accepting one strands it.
 */
export const messageChannelSchema = z.enum([
  "SMS",
  "Email",
  "WhatsApp",
  "IG",
  "FB",
  "Custom",
  "Live_Chat",
]);

export type MessageChannel = z.infer<typeof messageChannelSchema>;

/** A model binding is resolved by role, so the loop, the gate, and the judge can differ. */
const modelBindingSchema = z.object({
  provider: providerNameSchema,
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.3),
  /** Covers tool arguments too. Set too low, the model is cut off mid-call and returns nothing. */
  maxOutputTokens: z.number().int().positive().default(1_200),
  timeoutMs: z.number().int().positive().default(15_000),
});

const modelSettingsSchema = z.object({
  /** Tried in order. The first entry is the primary; the rest are the failover chain. */
  chain: z.array(modelBindingSchema).min(1),
  /** Cheap/fast model that answers "does this turn need retrieval at all?". */
  gate: modelBindingSchema,
  /** Used only by the eval suite. Kept off the chat provider to avoid self-grading bias. */
  judge: modelBindingSchema,
  /** Dimensions must match `kb_chunks.embedding`: changing it means a migration and a re-ingest. */
  embedding: z
    .object({ provider: providerNameSchema, model: z.string().min(1) })
    .default({ provider: "openai", model: "text-embedding-3-small" }),
});

const knowledgeSettingsSchema = z.object({
  /** Directory holding the knowledge base. Every .md file under it is indexed, recursively. */
  docsDir: z.string().default("kb"),
  chunkTokens: z.number().int().positive().default(500),
  chunkOverlapTokens: z.number().int().nonnegative().default(60),
  topK: z.number().int().positive().default(4),
  /** Below this cosine similarity the agent declines instead of stretching the context. */
  relevanceFloor: z.number().min(0).max(1).default(0.35),
  /** How eagerly the gate retrieves. Higher trades latency for recall. */
  retrievalAggressiveness: z.enum(["low", "balanced", "high"]).default("balanced"),
  /** If the gate LLM times out, retrieve anyway (true) or skip (false). */
  gateFailOpen: z.boolean().default(true),
  /** A remote call is 1–2s. Budget less and the gate times out every turn and never decides. */
  gateTimeoutMs: z.number().int().positive().default(2_500),
  /** Questions the KB could not answer are logged for the operator to review and fill. */
  logKnowledgeGaps: z.boolean().default(true),
});

const handoverSettingsSchema = z.object({
  triggers: z
    .object({
      explicitRequest: z.boolean().default(true),
      frustration: z.boolean().default(true),
      outOfScope: z.boolean().default(true),
      repeatedFailure: z.boolean().default(true),
    })
    .default({}),
  frustrationSensitivity: z.enum(["low", "medium", "high"]).default("medium"),
  /** Consecutive failed or repeated turns after which handover fires regardless of the model. */
  maxFailedTurns: z.number().int().positive().default(3),
  outOfScopeBehavior: z.enum(["offer", "auto", "answer_generic"]).default("offer"),
  tags: z.array(z.string()).default(["ai-handover", "needs-human"]),
  assignTo: z.string().nullable().default(null),
  sendFinalMessage: z.boolean().default(true),
  finalMessage: z
    .string()
    .default("I'm connecting you with a member of our team — they'll reply here shortly."),
  /** Whether the bot resumes after a period, or stays off until a human re-enables it. */
  resume: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("stop") }),
      z.object({ mode: z.literal("pause"), afterHours: z.number().positive() }),
    ])
    .default({ mode: "stop" }),
  /** One clarifying question is allowed before connecting, when the ask is ambiguous. */
  clarifyBeforeHandover: z.boolean().default(false),
});

const bookingSettingsSchema = z.object({
  /** Null means the location's first active calendar, which needs no setup at all. */
  calendarId: z.string().nullable().default(null),
  appointmentTitle: z.string().default("Appointment"),
  appointmentMinutes: z.number().int().positive().default(30),
  slotsOffered: z.number().int().positive().max(5).default(3),
  minNoticeMinutes: z.number().int().nonnegative().default(60),
  horizonDays: z.number().int().positive().default(30),
  /** Whose clock renders the offered times. */
  timezoneSource: z.enum(["contact", "calendar", "location"]).default("contact"),
  failureTag: z.string().default("booking-failed"),
  /** How long offered slots stay quotable. Stops the agent re-offering a time that has gone. */
  slotsFreshMinutes: z.number().int().positive().default(10),
});

const contactCaptureSettingsSchema = z.object({
  /** The agent may write nothing outside this allowlist. Standard fields plus custom field keys. */
  writableFields: z
    .array(z.string())
    .default(["firstName", "lastName", "email", "phone", "budget", "preferredTime"]),
  /** Identity fields the agent must read back and confirm before writing. */
  confirmBeforeWrite: z.array(z.string()).default(["email", "phone"]),
  /** How many times it may re-ask for one missing detail before moving on. */
  maxAsksPerField: z.number().int().positive().default(2),
  /** Whether a value the customer states replaces one already on the record. */
  overwriteExisting: z.boolean().default(false),
  /** Marks a name the harness invented, so the overwrite rule does not defend it as real. */
  placeholderTag: z.string().default("anonymous-visitor"),
});

const quietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().default("UTC"),
  /** The agent's character, in markdown. Edited far more often than any code that reads it. */
  soulPath: z.string().default("SOUL.md"),
  /** 24h "HH:MM". The agent replies only between start and end. */
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("09:00"),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("21:00"),
});

const behaviorSettingsSchema = z.object({
  /** Hard cap on agent messages per conversation — loop protection. */
  replyCap: z.number().int().positive().default(20),
  /** Rapid-fire customer messages collapse into one turn after this quiet period. */
  debounceMs: z.number().int().nonnegative().default(4_000),
  minReplyDelayMs: z.number().int().nonnegative().default(0),
  maxReplyDelayMs: z.number().int().nonnegative().default(0),
  quietHours: quietHoursSchema.default({}),
  channels: z.array(messageChannelSchema).default(["SMS", "Live_Chat"]),
  /** A contact carrying any excluded tag is out of automation entirely — the no-developer kill switch. */
  requiredContactTags: z.array(z.string()).default([]),
  excludedContactTags: z.array(z.string()).default(["no-ai"]),
  bannedPhrases: z.array(z.string()).default([]),
  /** When a human sends into the thread, the agent stands down. */
  standDownOnHumanReply: z.boolean().default(true),
  /** Silence before an acknowledgement reads as nothing happening. Null switches it off. */
  acknowledgeAfterMs: z.number().int().positive().nullable().default(2_000),
  /** Only skills that visibly take time. Acknowledging a fast one invents a delay. */
  acknowledgeSkills: z.array(z.string()).default(["book_appointment"]),
  /** When a note stops being worth carrying. Stale is still usable; ancient is noise. */
  memoryMaxAgeHours: z.number().positive().default(24),
  /** Loop guardrails: iterations and total wall-clock before a graceful fallback reply. */
  maxIterations: z.number().int().positive().default(6),
  turnBudgetMs: z.number().int().positive().default(20_000),
});

const safetySettingsSchema = z.object({
  declineMessage: z
    .string()
    .default(
      "I don't have that in what I've been given — I can pass this to the team if you'd like.",
    ),
  logDeclinedQuestions: z.boolean().default(true),
  /** Only when the harness could not reply at all. Not the handover message. See #loop-exits. */
  fallbackMessage: z
    .string()
    .default("Sorry — something went wrong on my side just now. Could you say that again?"),
});

const ghlSettingsSchema = z.object({
  /** Live_Chat: the one channel needing neither a phone number nor a conversation provider. */
  chatChannel: messageChannelSchema.default("Live_Chat"),
  /** For real SMS, which arrives through the provider as `messageType: "Custom"`. */
  conversationProviderId: z.string().nullable().default(null),
  /** "Custom" is receive-only — sending with it returns PROVIDER_NOT_SUPPORTED. */
  replyChannel: messageChannelSchema.default("SMS"),
});

export const settingsSchema = z
  .object({
    businessName: z.string().min(1),
    locationId: z.string().min(1),
    /** The business's clock, IANA. "Tomorrow" means where the business is, not the server. */
    timezone: z.string().default("UTC"),
    /** The agent's character, in markdown. Edited far more often than any code that reads it. */
    soulPath: z.string().default("SOUL.md"),
    ghl: ghlSettingsSchema.default({}),
    model: modelSettingsSchema,
    knowledge: knowledgeSettingsSchema.default({}),
    handover: handoverSettingsSchema.default({}),
    booking: bookingSettingsSchema.default({}),
    contactCapture: contactCaptureSettingsSchema.default({}),
    behavior: behaviorSettingsSchema.default({}),
    safety: safetySettingsSchema.default({}),
    skills: z.record(z.string(), z.boolean()).default({}),
  })
  .superRefine((settings, ctx) => {
    // Two timeouts apply to the gate and the tighter one wins silently. Set the model's below the
    // gate's budget and it aborts on every turn, the fail-open default quietly becomes the policy,
    // and nothing in the trace says the configuration is the reason.
    if (settings.model.gate.timeoutMs < settings.knowledge.gateTimeoutMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model", "gate", "timeoutMs"],
        message: `must be at least knowledge.gateTimeoutMs (${settings.knowledge.gateTimeoutMs}), or the gate aborts before its own budget and never decides anything`,
      });
    }
  });

export type Settings = z.infer<typeof settingsSchema>;
export type ModelBinding = z.infer<typeof modelBindingSchema>;
export type ModelRole = "chat" | "gate" | "judge";
