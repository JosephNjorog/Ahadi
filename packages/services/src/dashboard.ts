import { desc, eq, inArray } from "drizzle-orm";
import { FUNDS_HELD_STATES, type MilestoneState } from "@ahadi/core";
import {
  criterionResults,
  fundings,
  getDb,
  ledgerEvents,
  payouts,
  proposals,
  settlements,
  submissions,
  verifications,
} from "@ahadi/db";
import type { Actor } from "./actor";
import { listPromisesForActor } from "./queries";

/** One thing the signed-in person should do next, with where to do it. */
export type AttentionItem = {
  kind:
    | "sign_terms"
    | "fund"
    | "submit"
    | "decide"
    | "review"
    | "resubmit"
    | "hold_expiring"
    | "settlement_failed"
    | "mediation";
  tone: "danger" | "warn" | "info";
  title: string;
  detail: string;
  href: string;
  promiseId: string;
};

export type ActivityItem = {
  id: string;
  promiseId: string;
  promiseTitle: string;
  type: string;
  actor: string;
  at: Date;
  hash: string;
};

const DAY = 86_400_000;
const SERIES_DAYS = 30;

/**
 * Everything the dashboard shows, from the signed-in person's point of view:
 * money held / captured / returned / paid out, what needs them, holds about to
 * lapse, recent ledger activity and a 30-day money series for the charts.
 */
export async function getDashboardSummary(actor: Actor) {
  const list = await listPromisesForActor(actor);
  const db = getDb();
  const promiseIds = list.map((p) => p.id);
  const milestoneRows = list.flatMap((p) => p.milestones.map((m) => ({ ...m, promise: p })));
  const milestoneIds = milestoneRows.map((m) => m.id);

  // Settlement chain: settlement → proposal → verification → submission → milestone.
  const settled = milestoneIds.length
    ? await db
        .select({
          milestoneId: submissions.milestoneId,
          status: settlements.status,
          capturedMinor: settlements.capturedMinor,
          paypalFeeMinor: settlements.paypalFeeMinor,
          netMinor: settlements.netMinor,
          settlementId: settlements.id,
          createdAt: settlements.createdAt,
        })
        .from(settlements)
        .innerJoin(proposals, eq(proposals.id, settlements.proposalId))
        .innerJoin(verifications, eq(verifications.id, proposals.verificationId))
        .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
        .where(inArray(submissions.milestoneId, milestoneIds))
    : [];

  const payoutRows = settled.length
    ? await db
        .select()
        .from(payouts)
        .where(
          inArray(
            payouts.settlementId,
            settled.map((s) => s.settlementId),
          ),
        )
    : [];

  const fundingRows = milestoneIds.length
    ? await db
        .select()
        .from(fundings)
        .where(inArray(fundings.milestoneId, milestoneIds))
        .orderBy(desc(fundings.attempt))
    : [];

  const results = milestoneIds.length
    ? await db
        .select({ outcome: criterionResults.outcome, decidedBy: criterionResults.decidedBy })
        .from(criterionResults)
        .innerJoin(verifications, eq(verifications.id, criterionResults.verificationId))
        .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
        .where(inArray(submissions.milestoneId, milestoneIds))
    : [];

  const activityRows = promiseIds.length
    ? await db
        .select()
        .from(ledgerEvents)
        .where(inArray(ledgerEvents.promiseId, promiseIds))
        .orderBy(desc(ledgerEvents.createdAt))
        .limit(10)
    : [];

  const titleOf = new Map(list.map((p) => [p.id, p.title]));
  const roleOfMilestone = new Map(milestoneRows.map((m) => [m.id, m.promise.role]));

  // ---- money -------------------------------------------------------------
  const captured = settled.filter((s) => (s.capturedMinor ?? 0) > 0);
  const amountOf = new Map(milestoneRows.map((m) => [m.id, m.amountMinor]));
  const heldMinor = list.reduce((s, p) => s + p.heldMinor, 0);
  const capturedMinor = captured.reduce((s, x) => s + (x.capturedMinor ?? 0), 0);
  const paypalFeesMinor = captured.reduce((s, x) => s + (x.paypalFeeMinor ?? 0), 0);
  const returnedMinor = settled.reduce(
    (s, x) =>
      ["CAPTURED", "PAID", "VOIDED"].includes(x.status)
        ? s + Math.max(0, (amountOf.get(x.milestoneId) ?? 0) - (x.capturedMinor ?? 0))
        : s,
    0,
  );
  const paidOut = payoutRows.filter((p) => p.status === "SUCCESS");
  const paidOutMinor = paidOut.reduce((s, p) => s + p.amountMinor, 0);
  // From the worker's side: what reached them.
  const settlementRole = new Map(settled.map((s) => [s.settlementId, roleOfMilestone.get(s.milestoneId)]));
  const earnedMinor = paidOut
    .filter((p) => settlementRole.get(p.settlementId) === "worker")
    .reduce((s, p) => s + p.amountMinor, 0);

  // ---- verification quality ----------------------------------------------
  const decided = results.filter((r) => r.outcome !== "undetermined");
  const passed = decided.filter((r) => r.outcome === "pass").length;
  const partial = decided.filter((r) => r.outcome === "partial").length;
  const byMachine = results.filter((r) => r.decidedBy === "machine").length;
  const byAgent = results.filter((r) => r.decidedBy === "agent").length;
  const byHuman = results.filter((r) => r.decidedBy === "human").length;

  // ---- counts ------------------------------------------------------------
  const states = milestoneRows.map((m) => m.state as MilestoneState);
  const counts = {
    promises: list.length,
    asClient: list.filter((p) => p.role === "client").length,
    asWorker: list.filter((p) => p.role === "worker").length,
    active: list.filter((p) => !["COMPLETED", "CANCELLED", "DRAFT"].includes(p.state)).length,
    settled: states.filter((s) => s === "SETTLED").length,
    held: states.filter((s) => FUNDS_HELD_STATES.has(s)).length,
    inVerification: states.filter((s) => s === "VERIFYING" || s === "SUBMITTED" || s === "NEEDS_HUMAN")
      .length,
    milestones: states.length,
  };

  // ---- needs attention ---------------------------------------------------
  const attention: AttentionItem[] = [];
  const latestFunding = new Map<string, (typeof fundingRows)[number]>();
  for (const f of fundingRows) if (!latestFunding.has(f.milestoneId)) latestFunding.set(f.milestoneId, f);
  const now = Date.now();

  for (const p of list) {
    const role = p.role;
    if (p.state === "NEGOTIATING" && p.termsStatus === "idle") {
      attention.push({
        kind: "sign_terms",
        tone: "info",
        title: "Terms waiting for signature",
        detail: `${p.title} · review the criteria and sign`,
        href: `/promises/${p.id}`,
        promiseId: p.id,
      });
    }
    for (const m of p.milestones) {
      const st = m.state as MilestoneState;
      const at = `/promises/${p.id}`;
      const label = `${p.title} · ${m.title}`;
      if (st === "UNFUNDED" && p.state === "ACTIVE" && role === "client")
        attention.push({
          kind: "fund",
          tone: "warn",
          title: "Fund this milestone with PayPal",
          detail: label,
          href: `${at}/fund?milestone=${m.id}`,
          promiseId: p.id,
        });
      if (st === "FUNDED" && role === "worker")
        attention.push(
          m.attemptsUsed > 0
            ? {
                kind: "resubmit",
                tone: "warn",
                title: `Fix and resubmit (attempt ${m.attemptsUsed + 1} of ${m.maxAttempts})`,
                detail: label,
                href: `${at}/submit?milestone=${m.id}`,
                promiseId: p.id,
              }
            : {
                kind: "submit",
                tone: "info",
                title: "Funds secured: start and submit work",
                detail: label,
                href: `${at}/submit?milestone=${m.id}`,
                promiseId: p.id,
              },
        );
      if ((st === "VERDICT_READY" || st === "OBJECTION_WINDOW") && role)
        attention.push({
          kind: "decide",
          tone: "warn",
          title: "Proposal ready: accept or object",
          detail: label,
          href: `${at}/verify?milestone=${m.id}`,
          promiseId: p.id,
        });
      if (st === "NEEDS_HUMAN" && (role === "client" || !role))
        attention.push({
          kind: "review",
          tone: "warn",
          title: "Criteria need a human decision",
          detail: label,
          href: role ? `${at}/verify?milestone=${m.id}` : `/admin`,
          promiseId: p.id,
        });
      if (st === "MEDIATING")
        attention.push({
          kind: "mediation",
          tone: "info",
          title: "Mediation in progress",
          detail: label,
          href: `${at}/mediation?milestone=${m.id}`,
          promiseId: p.id,
        });
      if (st === "SETTLEMENT_FAILED")
        attention.push({
          kind: "settlement_failed",
          tone: "danger",
          title: "Settlement failed: needs attention",
          detail: label,
          href: at,
          promiseId: p.id,
        });
      const f = latestFunding.get(m.id);
      if (f?.honorExpiresAt && FUNDS_HELD_STATES.has(st)) {
        const left = f.honorExpiresAt.getTime() - now;
        if (left > 0 && left < 2 * DAY)
          attention.push({
            kind: "hold_expiring",
            tone: "danger",
            title: `PayPal hold honor period ends in ${Math.max(1, Math.round(left / 3_600_000))}h`,
            detail: `${label} · Ahadi will reauthorize automatically`,
            href: at,
            promiseId: p.id,
          });
      }
    }
  }
  const toneRank = { danger: 0, warn: 1, info: 2 } as const;
  attention.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);

  // ---- 30-day series (cumulative, in minor units) -------------------------
  const start = new Date(now - (SERIES_DAYS - 1) * DAY);
  start.setUTCHours(0, 0, 0, 0);
  const dayIndex = (d: Date) => Math.floor((d.getTime() - start.getTime()) / DAY);
  const capturedDaily = new Array<number>(SERIES_DAYS).fill(0);
  const securedDaily = new Array<number>(SERIES_DAYS).fill(0);
  let capturedBefore = 0;
  let securedBefore = 0;
  for (const s of captured) {
    const i = dayIndex(s.createdAt);
    if (i < 0) capturedBefore += s.capturedMinor ?? 0;
    else if (i < SERIES_DAYS) capturedDaily[i]! += s.capturedMinor ?? 0;
  }
  for (const f of fundingRows) {
    if (!["AUTHORIZED", "CAPTURED", "PARTIALLY_CAPTURED", "VOIDED", "EXPIRED"].includes(f.status)) continue;
    const i = dayIndex(f.createdAt);
    if (i < 0) securedBefore += f.amountMinor;
    else if (i < SERIES_DAYS) securedDaily[i]! += f.amountMinor;
  }
  const cumulative = (daily: number[], base: number) => {
    let run = base;
    return daily.map((v) => (run += v));
  };

  return {
    promises: list,
    counts,
    money: {
      currency: list[0]?.currency ?? "USD",
      heldMinor,
      capturedMinor,
      returnedMinor,
      paidOutMinor,
      earnedMinor,
      paypalFeesMinor,
    },
    verification: {
      decided: decided.length,
      passed,
      partial,
      passRate: decided.length ? passed / decided.length : null,
      byMachine,
      byAgent,
      byHuman,
    },
    attention,
    activity: activityRows.map((e): ActivityItem => ({
      id: String(e.id),
      promiseId: e.promiseId,
      promiseTitle: titleOf.get(e.promiseId) ?? "Promise",
      type: e.type,
      actor: e.actor,
      at: e.createdAt,
      hash: e.hash,
    })),
    series: {
      start,
      days: SERIES_DAYS,
      captured: cumulative(capturedDaily, capturedBefore),
      secured: cumulative(securedDaily, securedBefore),
    },
  };
}

export type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;

/** Lightweight count for the sidebar badge. */
export async function countAttention(actor: Actor) {
  const s = await getDashboardSummary(actor);
  return s.attention.length;
}
