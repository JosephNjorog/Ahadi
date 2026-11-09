import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import {
  getDb,
  mediations,
  milestones,
  passports,
  payouts,
  promises,
  proposals,
  riskFlags,
  settlements,
  submissions,
  users,
  verifications,
} from "@ahadi/db";
import { latestLedgerHash } from "@ahadi/ledger";
import { signDocument, signingPublicKey } from "./signing";

/** Ahadi Passport (SPEC §15). */

export interface PassportStats {
  displayName: string;
  country: string | null;
  memberSince: string;
  lastActive: string | null;
  settledCount: number;
  totalVerifiedMinor: number;
  totalVerifiedBucket: string;
  firstPassRate: number;
  avgReleaseRate: number;
  categories: Record<string, number>;
  recentWork: { title: string; category: string; settledAt: string; releasePct: number; client: string }[];
  disputes: { opened: number; resolvedInFavor: number };
  agentProvider: boolean;
}

export function bucket(minor: number): string {
  const usd = minor / 100;
  const edges = [0, 100, 500, 1000, 5000, 10000, 50000];
  for (let i = edges.length - 1; i >= 0; i--)
    if (usd >= edges[i]!)
      return i === edges.length - 1 ? `$${edges[i]! / 1000}k+` : `$${fmt(edges[i]!)}–${fmt(edges[i + 1]!)}`;
  return "$0";
}
const fmt = (n: number) => (n >= 1000 ? `${n / 1000}k` : `${n}`);

/** score = 0.5·first_pass + 0.3·avg_release + 0.2·min(1, settled/20) − penalty(high-risk flags) */
export function providerScore(
  s: Pick<PassportStats, "firstPassRate" | "avgReleaseRate" | "settledCount">,
  highRiskFlags: number,
): number {
  const raw =
    0.5 * s.firstPassRate +
    0.3 * s.avgReleaseRate +
    0.2 * Math.min(1, s.settledCount / 20) -
    0.25 * highRiskFlags;
  return Math.max(0, Math.min(1, Math.round(raw * 1000) / 1000));
}

const maskName = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => `${w[0] ?? ""}.`)
    .join(" ");

export async function recomputePassport(userId: string) {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("NOT_FOUND", "User not found");
  const rows = await db
    .select({
      promise: promises,
      milestone: milestones,
      proposal: proposals,
      settlement: settlements,
      attempt: submissions.attempt,
    })
    .from(settlements)
    .innerJoin(proposals, eq(proposals.id, settlements.proposalId))
    .innerJoin(verifications, eq(verifications.id, proposals.verificationId))
    .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
    .innerJoin(milestones, eq(milestones.id, submissions.milestoneId))
    .innerJoin(promises, eq(promises.id, milestones.promiseId))
    .where(
      and(eq(promises.workerUserId, userId), inArray(settlements.status, ["PAID", "CAPTURED", "VOIDED"])),
    );
  const settled = rows.filter((r) => r.milestone.state === "SETTLED" || r.milestone.state === "VOIDED");
  const clients = new Map(
    (
      await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(
          inArray(users.id, [
            ...new Set(settled.map((r) => r.promise.clientUserId!).filter(Boolean)),
            "00000000-0000-0000-0000-000000000000",
          ]),
        )
    ).map((c) => [c.id, c.displayName]),
  );
  const firstPass = settled.filter((r) => r.attempt === 1 && r.proposal.releaseBps === 10000).length;
  const total = settled.reduce((s, r) => s + (r.settlement.capturedMinor ?? 0), 0);
  const cats: Record<string, number> = {};
  for (const r of settled) cats[r.promise.category] = (cats[r.promise.category] ?? 0) + 1;
  const medRows = await db
    .select({ m: mediations, workerId: promises.workerUserId })
    .from(mediations)
    .innerJoin(milestones, eq(milestones.id, mediations.milestoneId))
    .innerJoin(promises, eq(promises.id, milestones.promiseId))
    .where(eq(promises.workerUserId, userId));
  const flags = await db
    .select({ id: riskFlags.id })
    .from(riskFlags)
    .where(
      and(
        eq(riskFlags.subjectType, "user"),
        eq(riskFlags.subjectId, userId),
        eq(riskFlags.severity, "high"),
        isNull(riskFlags.resolvedAt),
      ),
    );
  const lastActive = rows.map((r) => r.settlement.updatedAt).sort((a, b) => +b - +a)[0];

  const stats: PassportStats = {
    displayName: u.displayName,
    country: u.country,
    memberSince: u.createdAt.toISOString(),
    lastActive: lastActive?.toISOString() ?? null,
    settledCount: settled.length,
    totalVerifiedMinor: total,
    totalVerifiedBucket: bucket(total),
    firstPassRate: settled.length ? firstPass / settled.length : 0,
    avgReleaseRate: settled.length
      ? settled.reduce((s, r) => s + r.proposal.releaseBps, 0) / settled.length / 10000
      : 0,
    categories: cats,
    recentWork: settled
      .sort((a, b) => +b.settlement.updatedAt - +a.settlement.updatedAt)
      .slice(0, 10)
      .map((r) => ({
        title: r.promise.title,
        category: r.promise.category,
        settledAt: r.settlement.updatedAt.toISOString(),
        releasePct: r.proposal.releaseBps / 100,
        client: maskName(clients.get(r.promise.clientUserId ?? "") ?? "Client"),
      })),
    disputes: {
      opened: medRows.length,
      resolvedInFavor: medRows.filter((x) => x.m.outcome === "accepted" && x.m.openedBy === "worker").length,
    },
    agentProvider: false,
  };
  const slug =
    u.passportSlug ??
    `${
      u.displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 24) || "worker"
    }-${randomBytes(3).toString("hex")}`;
  if (!u.passportSlug) await db.update(users).set({ passportSlug: slug }).where(eq(users.id, userId));
  const score = providerScore(stats, flags.length);
  await db
    .insert(passports)
    .values({ userId, slug, stats, score, recomputedAt: new Date() })
    .onConflictDoUpdate({ target: passports.userId, set: { slug, stats, score, recomputedAt: new Date() } });
  return { slug, score, stats };
}

export async function getPassportBySlug(slug: string) {
  const db = getDb();
  let [p] = await db.select().from(passports).where(eq(passports.slug, slug));
  if (!p) {
    const [u] = await db.select().from(users).where(eq(users.passportSlug, slug));
    if (!u) throw new AppError("NOT_FOUND", "Passport not found");
    await recomputePassport(u.id);
    [p] = await db.select().from(passports).where(eq(passports.slug, slug));
  }
  const stats = p!.stats as PassportStats;
  return {
    slug: p!.slug,
    score: p!.score,
    recomputedAt: p!.recomputedAt,
    stats: { ...stats, totalVerifiedMinor: p!.showExactEarnings ? stats.totalVerifiedMinor : null },
    showExactEarnings: p!.showExactEarnings,
  };
}

export async function setEarningsVisibility(userId: string, showExact: boolean) {
  await getDb().update(passports).set({ showExactEarnings: showExact }).where(eq(passports.userId, userId));
}

/** Provider score used by mandates (SPEC §13 rule 5). */
export async function scoreForUser(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  const [p] = await getDb()
    .select({ score: passports.score })
    .from(passports)
    .where(eq(passports.userId, userId));
  if (p) return p.score;
  return (await recomputePassport(userId)).score;
}

/** Source-of-funds statement data (SPEC §15), signed with Ahadi's Ed25519 key. */
export async function buildStatement(userId: string) {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("NOT_FOUND", "User not found");
  const rows = await db
    .select({
      payout: payouts,
      settlement: settlements,
      proposal: proposals,
      verificationId: verifications.id,
      promise: promises,
      milestone: milestones,
    })
    .from(payouts)
    .innerJoin(settlements, eq(settlements.id, payouts.settlementId))
    .innerJoin(proposals, eq(proposals.id, settlements.proposalId))
    .innerJoin(verifications, eq(verifications.id, proposals.verificationId))
    .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
    .innerJoin(milestones, eq(milestones.id, submissions.milestoneId))
    .innerJoin(promises, eq(promises.id, milestones.promiseId))
    .where(
      and(
        eq(payouts.status, "SUCCESS"),
        inArray(payouts.recipientPaypalEmail, [u.paypalEmail ?? "-", u.email]),
      ),
    )
    .orderBy(desc(payouts.updatedAt));
  const clientNames = new Map(
    (
      await db
        .select({ id: users.id, n: users.displayName })
        .from(users)
        .where(
          inArray(users.id, [
            ...new Set(rows.map((r) => r.promise.clientUserId!).filter(Boolean)),
            "00000000-0000-0000-0000-000000000000",
          ]),
        )
    ).map((c) => [c.id, c.n]),
  );
  const items = [];
  for (const r of rows) {
    items.push({
      date: r.payout.updatedAt.toISOString().slice(0, 10),
      amountMinor: r.payout.amountMinor,
      currency: r.payout.currency,
      payer: maskName(clientNames.get(r.promise.clientUserId ?? "") ?? "Client"),
      promise: r.promise.title,
      milestone: r.milestone.title,
      releasePct: r.proposal.releaseBps / 100,
      verificationId: r.verificationId,
      paypalPayoutItemId: r.payout.paypalPayoutItemId,
      ledgerHead: await latestLedgerHash(db, r.promise.id),
    });
  }
  const doc = {
    issuer: "Ahadi",
    type: "source-of-funds-statement",
    version: 1,
    issuedAt: new Date().toISOString(),
    subject: { name: u.displayName, email: u.paypalEmail ?? u.email, country: u.country },
    totalMinor: items.reduce((s, i) => s + i.amountMinor, 0),
    items,
  };
  const sig = signDocument(doc);
  return { doc, signature: sig.signature, kid: sig.kid, publicKey: signingPublicKey() };
}
