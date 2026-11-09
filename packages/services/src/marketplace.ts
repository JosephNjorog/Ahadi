import { and, desc, eq, ilike, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";
import { AppError, CATEGORIES, CriterionSchema, dollarsToMinor } from "@ahadi/core";
import { agents, getDb, passports, services, users } from "@ahadi/db";
import { actorUserId, type Actor } from "./actor";
import type { PassportStats } from "./passport";

/** SPEC §14 marketplace. Providers are people or their provider agents. */

export const ServiceInput = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(4).max(100),
  description: z.string().trim().min(20).max(2000),
  priceUsd: z.number().positive().max(100_000),
  turnaroundHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  providerAgentId: z.string().uuid().optional(),
  defaultCriteria: z.array(CriterionSchema).max(8).optional(),
  active: z.boolean().default(true),
});

export async function createService(actor: Actor, raw: unknown) {
  const owner = actorUserId(actor);
  if (!owner) throw new AppError("UNAUTHENTICATED", "Sign in");
  const input = ServiceInput.parse(raw);
  if (input.providerAgentId) {
    const [a] = await getDb().select().from(agents).where(eq(agents.id, input.providerAgentId));
    if (!a || a.ownerId !== owner || a.kind === "buyer")
      throw new AppError("FORBIDDEN", "That agent can't provide services");
  }
  const [s] = await getDb()
    .insert(services)
    .values({
      providerUserId: owner,
      providerAgentId: input.providerAgentId ?? null,
      category: input.category,
      title: input.title,
      description: input.description,
      priceMinor: dollarsToMinor(input.priceUsd),
      turnaroundHours: input.turnaroundHours,
      defaultCriteria: input.defaultCriteria ?? null,
      active: input.active,
    })
    .returning();
  return s!;
}

export async function updateService(actor: Actor, id: string, raw: unknown) {
  const [s] = await getDb().select().from(services).where(eq(services.id, id));
  if (!s || s.providerUserId !== actorUserId(actor)) throw new AppError("NOT_FOUND", "Service not found");
  const input = ServiceInput.partial().parse(raw);
  const [u] = await getDb()
    .update(services)
    .set({ ...input, ...(input.priceUsd ? { priceMinor: dollarsToMinor(input.priceUsd) } : {}) })
    .where(eq(services.id, id))
    .returning();
  return u!;
}

export async function myServices(actor: Actor) {
  const owner = actorUserId(actor);
  if (!owner) return [];
  return getDb()
    .select()
    .from(services)
    .where(eq(services.providerUserId, owner))
    .orderBy(desc(services.priceMinor));
}

export const SearchInput = z.object({
  category: z.enum(CATEGORIES).optional(),
  query: z.string().trim().max(200).optional(),
  maxPriceUsd: z.number().positive().optional(),
  minScore: z.number().min(0).max(1).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

/** search_providers (SPEC §12): providers with verified score, price and recent verified work. */
export async function searchProviders(raw: unknown) {
  const q = SearchInput.parse(raw ?? {});
  const db = getDb();
  const rows = await db
    .select({
      s: services,
      u: {
        id: users.id,
        displayName: users.displayName,
        country: users.country,
        passportSlug: users.passportSlug,
      },
      a: { id: agents.id, name: agents.name },
    })
    .from(services)
    .leftJoin(users, eq(users.id, services.providerUserId))
    .leftJoin(agents, eq(agents.id, services.providerAgentId))
    .where(
      and(
        eq(services.active, true),
        q.category ? eq(services.category, q.category) : undefined,
        q.maxPriceUsd ? lte(services.priceMinor, dollarsToMinor(q.maxPriceUsd)) : undefined,
        q.query
          ? or(ilike(services.title, `%${q.query}%`), ilike(services.description, `%${q.query}%`))
          : undefined,
      ),
    )
    .limit(100);
  const ps = rows.length
    ? await db
        .select()
        .from(passports)
        .where(inArray(passports.userId, rows.map((r) => r.u?.id).filter(Boolean) as string[]))
    : [];
  return rows
    .map((r) => {
      const p = ps.find((x) => x.userId === r.u?.id);
      const stats = p?.stats as PassportStats | undefined;
      return {
        serviceId: r.s.id,
        title: r.s.title,
        description: r.s.description,
        category: r.s.category,
        priceUsd: r.s.priceMinor / 100,
        turnaroundHours: r.s.turnaroundHours,
        provider: {
          name: r.a?.name ?? r.u?.displayName ?? "Provider",
          kind: r.a ? "agent" : "human",
          country: r.u?.country ?? null,
          passport: r.u?.passportSlug ? `/p/${r.u.passportSlug}` : null,
        },
        score: p?.score ?? 0,
        settledCount: stats?.settledCount ?? 0,
        firstPassRate: stats?.firstPassRate ?? 0,
        sampleDeliverables: (stats?.recentWork ?? []).slice(0, 3).map((w) => w.title),
      };
    })
    .filter((r) => (q.minScore == null ? true : r.score >= q.minScore))
    .sort((a, b) => b.score - a.score || a.priceUsd - b.priceUsd)
    .slice(0, q.limit);
}
