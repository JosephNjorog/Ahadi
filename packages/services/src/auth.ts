import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";
import { authTokens, getDb, passports, users, type User } from "@ahadi/db";
import { sendEmail } from "./email";
import { log } from "./log";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const EmailSchema = z.string().trim().toLowerCase().email().max(254);

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Request a magic link. Always behaves the same whether or not the email exists (no account enumeration). */
export async function requestMagicLink(
  rawEmail: string,
  nextPath = "/dashboard",
): Promise<{ devLink?: string }> {
  const email = EmailSchema.parse(rawEmail);
  const env = getEnv();
  const token = randomBytes(32).toString("base64url");
  await getDb()
    .insert(authTokens)
    .values({ email, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS) });
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";
  const link = `${env.APP_URL.replace(/\/$/, "")}/api/auth/callback?token=${token}&next=${encodeURIComponent(safeNext)}`;
  const { delivered } = await sendEmail({
    to: email,
    subject: "Your Ahadi sign-in link",
    text: `Sign in to Ahadi:\n\n${link}\n\nThis link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
    html: `<p>Sign in to Ahadi:</p><p><a href="${link}">Sign in</a></p><p style="color:#666">This link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
  });
  // Without an email provider in development, surface the link so sign-in still works.
  return !delivered && env.NODE_ENV !== "production" ? { devLink: link } : {};
}

/** Consume a magic-link token; creates the account on first sign-in. */
export async function consumeMagicLink(token: string): Promise<User> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning();
  if (!row) throw new AppError("UNAUTHENTICATED", "This sign-in link is invalid or has expired");
  const [existing] = await db.select().from(users).where(eq(users.email, row.email));
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({ email: row.email, displayName: row.email.split("@")[0]! })
    .onConflictDoNothing({ target: users.email })
    .returning();
  log.info({ user_id: created?.id }, "user created via magic link");
  return created ?? (await db.select().from(users).where(eq(users.email, row.email)))[0]!;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const [u] = await getDb().select().from(users).where(eq(users.id, id));
  return u;
}

export type DemoRole = "client" | "worker" | "admin";

/** One-click demo identities (DEMO_MODE only). */
export async function demoUser(role: DemoRole): Promise<User> {
  const env = getEnv();
  if (!env.DEMO_MODE) throw new AppError("FORBIDDEN", "Demo sign-in is disabled");
  const email =
    role === "client"
      ? env.DEMO_CLIENT_EMAIL
      : role === "worker"
        ? env.DEMO_WORKER_EMAIL
        : env.DEMO_ADMIN_EMAIL;
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  if (!u) throw new AppError("NOT_FOUND", "Demo users are missing — run npm run db:seed");
  return u;
}

const ProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  paypalEmail: z.union([EmailSchema, z.literal("")]).transform((v) => v || null),
  country: z.union([z.string().trim().length(2).toUpperCase(), z.literal("")]).transform((v) => v || null),
  phoneE164: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\+[1-9]\d{7,14}$/, "Use international format, e.g. +254712345678"),
      z.literal(""),
    ])
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  showExactEarnings: z.boolean().optional(),
});

export async function updateProfile(userId: string, input: unknown): Promise<User> {
  const parsed = ProfileSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "VALIDATION_FAILED",
      "Check the highlighted fields",
      parsed.error.flatten().fieldErrors,
    );
  const { showExactEarnings, ...profile } = parsed.data;
  if (profile.phoneE164) {
    const [taken] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneE164, profile.phoneE164));
    if (taken && taken.id !== userId)
      throw new AppError("VALIDATION_FAILED", "That phone number is linked to another account", {
        phoneE164: ["Already in use"],
      });
  }
  const [u] = await getDb().update(users).set(profile).where(eq(users.id, userId)).returning();
  if (!u) throw new AppError("NOT_FOUND", "User not found");
  if (showExactEarnings !== undefined)
    await getDb().update(passports).set({ showExactEarnings }).where(eq(passports.userId, userId));
  return u;
}
