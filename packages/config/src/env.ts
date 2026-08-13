import { z } from "zod";

/** An optional secret. A blank key in `.env` is absent, not invalid. */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value !== undefined && value.length > 0 ? value : undefined));

/** Secrets and deployment wiring. Anything an operator tunes belongs in `settings.ts`. */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  GHL_APP_CLIENT_ID: z.string().min(1),
  GHL_APP_CLIENT_SECRET: z.string().min(1),
  /** SSO only. Everything else works without it, so its absence must not stop the boot. */
  GHL_APP_SSO_KEY: optionalSecret,
  GHL_API_DOMAIN: z.string().url().default("https://services.leadconnectorhq.com"),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),

  ANTHROPIC_API_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalSecret,

  /** Promotes one provider to the head of the chat chain. Reorders only; never adds. */
  MODEL_PROVIDER: z.enum(["anthropic", "openai", "google"]).optional(),

  /**
   * Browser origins allowed to call this server cross-origin, comma-separated.
   * Empty in dev, where the Vite proxy puts the apps on one origin. See #cors.
   */
  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  SETTINGS_PATH: z.string().default("./settings.yaml"),
});

export type Env = z.infer<typeof envSchema>;

/** Throws with every bad key listed at once, so a deploy fails at boot not on first message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
