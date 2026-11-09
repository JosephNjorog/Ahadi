import { z } from "zod";
import { AppError } from "./errors";

/**
 * Server-side environment, validated once. Missing optional integrations (Anthropic,
 * WhatsApp, STT) don't stop the app from booting; features check `isConfigured()`.
 */

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  DEMO_MODE: bool,

  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: optionalString,
  REDIS_URL: z.string().default("redis://localhost:6379"),

  PAYPAL_ENV: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_WEBHOOK_ID: optionalString,

  ANTHROPIC_API_KEY: optionalString,
  MODEL_ARCHITECT: z.string().default("claude-opus-5-5"),
  MODEL_VERIFIER: z.string().default("claude-sonnet-5-5"),
  MODEL_FAST: z.string().default("claude-haiku-5-5"),

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().default("Ahadi <no-reply@ahadi.dev>"),

  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(150),
  OBJECTION_WINDOW_HOURS: z.coerce.number().min(0).default(48),
  HUMAN_CONFIRM_ABOVE_USD: z.coerce.number().min(0).default(1000),
  MIN_AUTO_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  KES_PER_USD: z.coerce.number().positive().default(129.5),

  DEMO_CLIENT_EMAIL: z.string().default("client@ahadi.test"),
  DEMO_WORKER_EMAIL: z.string().default("worker@ahadi.test"),
  DEMO_ADMIN_EMAIL: z.string().default("admin@ahadi.test"),
  DEMO_BUYER_PAYPAL_EMAIL: optionalString,
  DEMO_WORKER_PAYPAL_EMAIL: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new AppError("CONFIG_MISSING", `Invalid environment: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests. */
export function resetEnvCache() {
  cached = undefined;
}

export function getPolicy(env: Env = getEnv()) {
  return {
    platformFeeBps: env.PLATFORM_FEE_BPS,
    objectionWindowMs: Math.round(env.OBJECTION_WINDOW_HOURS * 3600_000),
    humanConfirmAboveMinor: Math.round(env.HUMAN_CONFIRM_ABOVE_USD * 100),
    minAutoConfidence: env.MIN_AUTO_CONFIDENCE,
    maxAttempts: env.MAX_ATTEMPTS,
    kesPerUsd: env.KES_PER_USD,
  };
}

export function paypalConfigured(env: Env = getEnv()): boolean {
  return Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
}
