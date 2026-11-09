import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError, CATEGORIES, dollarsToMinor, formatMoney } from "@ahadi/core";
import {
  agentActions,
  agents,
  fundings,
  getDb,
  mandates,
  milestones,
  promises,
  users,
  type AgentRow,
  type Mandate,
} from "@ahadi/db";
import { actorUserId, type Actor } from "./actor";

/** SPEC §19 agent API keys (SHA-256, shown once) and §13 spending mandates. */

const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

export const CreateAgentInput = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(["buyer", "provider", "both"]),
  description: z.string().trim().max(500).optional(),
  providerWebhookUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://") || u.startsWith("internal:"), "Use an https:// URL")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function createAgent(actor: Actor, raw: unknown) {
  const ownerId = actorUserId(actor);
  if (!ownerId || actor.kind !== "user")
    throw new AppError("FORBIDDEN", "Only signed-in people create agents");
  const input = CreateAgentInput.parse(raw);
  const key = `ahk_${randomBytes(24).toString("base64url")}`;
  const [a] = await getDb()
    .insert(agents)
    .values({
      ownerId,
      name: input.name,
      kind: input.kind,
      description: input.description ?? null,
      providerWebhookUrl: input.providerWebhookUrl ?? null,
      apiKeyHash: hashKey(key),
      apiKeyPrefix: key.slice(0, 12),
    })
    .returning();
  return { agent: publicAgent(a!), apiKey: key };
}

export async function rotateAgentKey(actor: Actor, agentId: string) {
  const a = await ownedAgent(actor, agentId);
  const key = `ahk_${randomBytes(24).toString("base64url")}`;
  await getDb()
    .update(agents)
    .set({ apiKeyHash: hashKey(key), apiKeyPrefix: key.slice(0, 12) })
    .where(eq(agents.id, a.id));
  return { apiKey: key };
}

export async function revokeAgent(actor: Actor, agentId: string) {
  const a = await ownedAgent(actor, agentId);
  await getDb().update(agents).set({ revokedAt: new Date() }).where(eq(agents.id, a.id));
}

export async function updateAgent(actor: Actor, agentId: string, raw: unknown) {
  const a = await ownedAgent(actor, agentId);
  const input = CreateAgentInput.partial().parse(raw);
  const [u] = await getDb().update(agents).set(input).where(eq(agents.id, a.id)).returning();
  return publicAgent(u!);
}

export async function listAgents(actor: Actor) {
  const ownerId = actorUserId(actor);
  if (!ownerId) return [];
  const rows = await getDb()
    .select()
    .from(agents)
    .where(eq(agents.ownerId, ownerId))
    .orderBy(desc(agents.createdAt));
  const ms = rows.length
    ? await getDb()
        .select()
        .from(mandates)
        .where(
          inArray(
            mandates.agentId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return Promise.all(
    rows.map(async (r) => ({
      ...publicAgent(r),
      mandate: ms.find((m) => m.agentId === r.id) ?? null,
      spend: await monthToDateSpend(r.id),
    })),
  );
}

export async function getAgentDetail(actor: Actor, agentId: string) {
  const a = await ownedAgent(actor, agentId);
  const [m] = await getDb().select().from(mandates).where(eq(mandates.agentId, a.id));
  const actions = await getDb()
    .select()
    .from(agentActions)
    .where(eq(agentActions.agentId, a.id))
    .orderBy(desc(agentActions.createdAt))
    .limit(50);
  return { agent: publicAgent(a), mandate: m ?? null, spend: await monthToDateSpend(a.id), actions };
}

function publicAgent(a: AgentRow) {
  const { apiKeyHash: _h, ...rest } = a;
  return rest;
}

async function ownedAgent(actor: Actor, agentId: string) {
  const [a] = await getDb().select().from(agents).where(eq(agents.id, agentId));
  if (!a || a.ownerId !== actorUserId(actor)) throw new AppError("NOT_FOUND", "Agent not found");
  return a;
}

/** Bearer key → agent actor. Constant-time by construction (hash lookup). */
export async function authenticateAgentKey(
  key: string | null | undefined,
): Promise<Extract<Actor, { kind: "agent" }> | null> {
  if (!key || !key.startsWith("ahk_")) return null;
  const [a] = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.apiKeyHash, hashKey(key)), isNull(agents.revokedAt)));
  if (!a) return null;
  const [owner] = await getDb().select().from(users).where(eq(users.id, a.ownerId));
  if (!owner) return null;
  return { kind: "agent", agent: a, owner };
}

export async function logAgentAction(
  agentId: string,
  tool: string,
  input: unknown,
  result: "ok" | "error",
  detail?: unknown,
) {
  await getDb()
    .insert(agentActions)
    .values({
      agentId,
      tool,
      input: redact(input) as Record<string, unknown>,
      result,
      detail: (detail ?? null) as Record<string, unknown> | null,
    })
    .catch(() => undefined);
}

function redact(v: unknown): unknown {
  return JSON.parse(
    JSON.stringify(v ?? {}, (k, val) =>
      typeof val === "string" && val.length > 500 ? `${val.slice(0, 500)}…` : val,
    ),
  );
}

/* ─────────────── Mandates (SPEC §13) ─────────────── */

export const MandateInput = z.object({
  perJobMaxUsd: z.number().positive().max(100_000),
  monthlyMaxUsd: z.number().positive().max(1_000_000),
  allowedCategories: z.array(z.enum(CATEGORIES)).min(1),
  minProviderScore: z.number().min(0).max(1).default(0),
  requireOwnerApprovalAboveUsd: z.number().positive().nullable().optional(),
  active: z.boolean().default(true),
});

export async function setMandate(actor: Actor, agentId: string, raw: unknown): Promise<Mandate> {
  const a = await ownedAgent(actor, agentId);
  const m = MandateInput.parse(raw);
  if (m.perJobMaxUsd > m.monthlyMaxUsd)
    throw new AppError("VALIDATION_FAILED", "Per-job limit can't exceed the monthly limit");
  const values = {
    agentId: a.id,
    perJobMaxMinor: dollarsToMinor(m.perJobMaxUsd),
    monthlyMaxMinor: dollarsToMinor(m.monthlyMaxUsd),
    allowedCategories: m.allowedCategories,
    minProviderScore: m.minProviderScore,
    requireOwnerApprovalAboveMinor: m.requireOwnerApprovalAboveUsd
      ? dollarsToMinor(m.requireOwnerApprovalAboveUsd)
      : null,
    active: m.active,
  };
  const [row] = await getDb()
    .insert(mandates)
    .values(values)
    .onConflictDoUpdate({ target: mandates.agentId, set: values })
    .returning();
  return row!;
}

/** Funded this calendar month (UTC): fundings in AUTHORIZED and later states for promises this agent is client of. */
export async function monthToDateSpend(agentId: string): Promise<number> {
  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${fundings.amountMinor}), 0)` })
    .from(fundings)
    .innerJoin(milestones, eq(milestones.id, fundings.milestoneId))
    .innerJoin(promises, eq(promises.id, milestones.promiseId))
    .where(
      and(
        eq(promises.clientAgentId, agentId),
        inArray(fundings.status, ["AUTHORIZED", "REAUTHORIZED", "PARTIALLY_CAPTURED", "CAPTURED"]),
        gte(fundings.createdAt, start),
      ),
    );
  return Number(row?.total ?? 0);
}

export class MandateError extends AppError {
  constructor(rule: string, limit: unknown, attempted: unknown, message: string) {
    super("MANDATE_EXCEEDED", message, { code: "MANDATE_EXCEEDED", rule, limit, attempted });
  }
}

/** core/policy.ts#assertMandate (SPEC §13). Returns whether owner approval is required. */
export async function assertMandate(
  agentId: string,
  args: { amountMinor: number; category: string; providerScore?: number | null },
): Promise<{ ownerApprovalRequired: boolean }> {
  const [m] = await getDb().select().from(mandates).where(eq(mandates.agentId, agentId));
  if (!m)
    throw new MandateError(
      "mandate_missing",
      null,
      null,
      "This agent has no spending mandate. Its owner must set one first.",
    );
  if (!m.active)
    throw new MandateError("mandate_inactive", false, true, "This agent's mandate is paused by its owner.");
  if (args.amountMinor > m.perJobMaxMinor)
    throw new MandateError(
      "per_job_max",
      formatMoney(m.perJobMaxMinor),
      formatMoney(args.amountMinor),
      `This job (${formatMoney(args.amountMinor)}) is over the per-job limit of ${formatMoney(m.perJobMaxMinor)}.`,
    );
  const mtd = await monthToDateSpend(agentId);
  if (mtd + args.amountMinor > m.monthlyMaxMinor)
    throw new MandateError(
      "monthly_max",
      formatMoney(m.monthlyMaxMinor),
      formatMoney(mtd + args.amountMinor),
      `This would bring spending this month to ${formatMoney(mtd + args.amountMinor)}, over the ${formatMoney(m.monthlyMaxMinor)} monthly limit.`,
    );
  if (!m.allowedCategories.includes(args.category))
    throw new MandateError(
      "category",
      m.allowedCategories,
      args.category,
      `Category "${args.category}" is not allowed (allowed: ${m.allowedCategories.join(", ")}).`,
    );
  if (args.providerScore != null && args.providerScore < m.minProviderScore)
    throw new MandateError(
      "min_provider_score",
      m.minProviderScore,
      args.providerScore,
      `The provider's verified score (${args.providerScore}) is below the minimum ${m.minProviderScore}.`,
    );
  return {
    ownerApprovalRequired:
      m.requireOwnerApprovalAboveMinor != null && args.amountMinor > m.requireOwnerApprovalAboveMinor,
  };
}

export async function mandateStatus(agentId: string) {
  const [m] = await getDb().select().from(mandates).where(eq(mandates.agentId, agentId));
  if (!m) return { configured: false as const };
  const mtd = await monthToDateSpend(agentId);
  return {
    configured: true as const,
    active: m.active,
    currency: m.currency,
    perJobMaxUsd: m.perJobMaxMinor / 100,
    monthlyMaxUsd: m.monthlyMaxMinor / 100,
    monthToDateUsd: mtd / 100,
    monthlyRemainingUsd: Math.max(0, m.monthlyMaxMinor - mtd) / 100,
    allowedCategories: m.allowedCategories,
    minProviderScore: m.minProviderScore,
    requireOwnerApprovalAboveUsd:
      m.requireOwnerApprovalAboveMinor != null ? m.requireOwnerApprovalAboveMinor / 100 : null,
  };
}
