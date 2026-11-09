import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { AppError, FUNDS_HELD_STATES, type MilestoneState } from "@ahadi/core";
import {
  criteria,
  criterionResults,
  fundings,
  getDb,
  jobFailures,
  milestones,
  payouts,
  promises,
  proposals,
  settlements,
  signatures,
  submissions,
  termsVersions,
  users,
  verifications,
  webhookEvents,
} from "@ahadi/db";
import { getLedger, verifyLedger } from "@ahadi/ledger";
import { assertCanView, isAdmin, partyRole, type Actor } from "./actor";

export async function listPromisesForActor(actor: Actor) {
  if (actor.kind !== "user") throw new AppError("UNAUTHENTICATED", "Sign in");
  const db = getDb();
  const where = isAdmin(actor) ? undefined : or(eq(promises.clientUserId, actor.user.id), eq(promises.workerUserId, actor.user.id));
  const rows = await db.select().from(promises).where(where).orderBy(desc(promises.updatedAt));
  if (rows.length === 0) return [];
  const ms = await db.select().from(milestones).where(inArray(milestones.promiseId, rows.map((r) => r.id))).orderBy(asc(milestones.position));
  const people = await peopleById(rows.flatMap((r) => [r.clientUserId, r.workerUserId]));
  return rows.map((p) => {
    const own = ms.filter((m) => m.promiseId === p.id);
    return {
      ...p,
      role: partyRole(actor, p),
      client: p.clientUserId ? people.get(p.clientUserId) : undefined,
      worker: p.workerUserId ? people.get(p.workerUserId) : undefined,
      totalMinor: own.reduce((s, m) => s + m.amountMinor, 0),
      heldMinor: own.filter((m) => FUNDS_HELD_STATES.has(m.state as MilestoneState)).reduce((s, m) => s + m.amountMinor, 0),
      milestones: own,
    };
  });
}

async function peopleById(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter(Boolean) as string[])];
  if (!unique.length) return new Map<string, { id: string; displayName: string; email: string; paypalEmail: string | null }>();
  const rows = await getDb()
    .select({ id: users.id, displayName: users.displayName, email: users.email, paypalEmail: users.paypalEmail })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Everything the promise, fund and admin screens need, in one round of queries. */
export async function getPromiseDetail(actor: Actor, promiseId: string) {
  const db = getDb();
  const [p] = await db.select().from(promises).where(eq(promises.id, promiseId));
  if (!p) throw new AppError("NOT_FOUND", "Promise not found");
  assertCanView(actor, p);

  const ms = await db.select().from(milestones).where(eq(milestones.promiseId, p.id)).orderBy(asc(milestones.position));
  const msIds = ms.map((m) => m.id);
  const [crit, funds, subs, terms, people] = await Promise.all([
    msIds.length ? db.select().from(criteria).where(inArray(criteria.milestoneId, msIds)).orderBy(asc(criteria.key)) : [],
    msIds.length ? db.select().from(fundings).where(inArray(fundings.milestoneId, msIds)).orderBy(desc(fundings.attempt)) : [],
    msIds.length ? db.select().from(submissions).where(inArray(submissions.milestoneId, msIds)).orderBy(desc(submissions.attempt)) : [],
    p.currentTermsVersionId ? db.select().from(termsVersions).where(eq(termsVersions.id, p.currentTermsVersionId)) : [],
    peopleById([p.clientUserId, p.workerUserId]),
  ]);
  const sigs = terms[0] ? await db.select().from(signatures).where(eq(signatures.termsVersionId, terms[0].id)) : [];

  const subIds = subs.map((s) => s.id);
  const vers = subIds.length ? await db.select().from(verifications).where(inArray(verifications.submissionId, subIds)).orderBy(desc(verifications.startedAt)) : [];
  const verIds = vers.map((v) => v.id);
  const [results, props] = await Promise.all([
    verIds.length ? db.select().from(criterionResults).where(inArray(criterionResults.verificationId, verIds)) : [],
    verIds.length ? db.select().from(proposals).where(inArray(proposals.verificationId, verIds)) : [],
  ]);
  const propIds = props.map((x) => x.id);
  const setts = propIds.length ? await db.select().from(settlements).where(inArray(settlements.proposalId, propIds)) : [];
  const settIds = setts.map((s) => s.id);
  const pays = settIds.length ? await db.select().from(payouts).where(inArray(payouts.settlementId, settIds)) : [];

  const role = partyRole(actor, p);
  const milestonesOut = ms.map((m) => {
    const mSubs = subs.filter((s) => s.milestoneId === m.id);
    const latestSub = mSubs[0];
    const latestVer = latestSub ? vers.find((v) => v.submissionId === latestSub.id) : undefined;
    const proposal = latestVer ? props.find((x) => x.verificationId === latestVer.id) : undefined;
    const settlement = proposal ? setts.find((s) => s.proposalId === proposal.id) : undefined;
    const mFundings = funds.filter((f) => f.milestoneId === m.id);
    return {
      ...m,
      criteria: crit.filter((c) => c.milestoneId === m.id),
      funding: mFundings.find((f) => !["CANCELLED"].includes(f.status)) ?? mFundings[0],
      fundingHistory: mFundings,
      latestSubmission: latestSub,
      verification: latestVer,
      results: latestVer ? results.filter((r) => r.verificationId === latestVer.id) : [],
      proposal,
      settlement,
      payouts: settlement ? pays.filter((x) => x.settlementId === settlement.id) : [],
    };
  });

  return {
    promise: p,
    role,
    viewerIsAdmin: isAdmin(actor),
    client: p.clientUserId ? people.get(p.clientUserId) : undefined,
    worker: p.workerUserId ? people.get(p.workerUserId) : undefined,
    terms: terms[0],
    signatures: sigs,
    milestones: milestonesOut,
  };
}

export type PromiseDetail = Awaited<ReturnType<typeof getPromiseDetail>>;

export async function getPromiseLedger(actor: Actor, promiseId: string) {
  const db = getDb();
  const [p] = await db.select().from(promises).where(eq(promises.id, promiseId));
  if (!p) throw new AppError("NOT_FOUND", "Promise not found");
  assertCanView(actor, p);
  const [events, verification] = await Promise.all([getLedger(db, promiseId), verifyLedger(db, promiseId)]);
  return { promise: p, events, verification };
}

/** Admin "money map" (SPEC §24) and operational lists. */
export async function getAdminOverview() {
  const db = getDb();
  const money = await db.execute<{
    authorized: string | null;
    held: string | null;
    captured: string | null;
    voided: string | null;
    paid_out: string | null;
    paypal_fees: string | null;
  }>(sql`
    select
      (select coalesce(sum(amount_minor),0) from ${fundings} where status in ('AUTHORIZED','REAUTHORIZED','PARTIALLY_CAPTURED','CAPTURED','VOIDED','EXPIRED')) as authorized,
      (select coalesce(sum(amount_minor),0) from ${fundings} where status in ('AUTHORIZED','REAUTHORIZED')) as held,
      (select coalesce(sum(captured_minor),0) from ${settlements} where status in ('CAPTURED','PAID')) as captured,
      (select coalesce(sum(amount_minor),0) from ${fundings} where status = 'VOIDED') as voided,
      (select coalesce(sum(amount_minor),0) from ${payouts} where status = 'SUCCESS') as paid_out,
      (select coalesce(sum(paypal_fee_minor),0) from ${settlements}) as paypal_fees
  `);
  const m = money.rows[0]!;
  const n = (v: string | null) => Number(v ?? 0);

  const [fundingRows, settlementRows, payoutRows, failedWebhooks, deadJobs] = await Promise.all([
    db
      .select({ f: fundings, m: { id: milestones.id, title: milestones.title, state: milestones.state, promiseId: milestones.promiseId } })
      .from(fundings)
      .innerJoin(milestones, eq(milestones.id, fundings.milestoneId))
      .orderBy(desc(fundings.createdAt))
      .limit(50),
    db.select().from(settlements).orderBy(desc(settlements.createdAt)).limit(50),
    db.select().from(payouts).orderBy(desc(payouts.createdAt)).limit(50),
    db
      .select()
      .from(webhookEvents)
      .where(and(isNull(webhookEvents.processedAt), sql`${webhookEvents.error} is not null`))
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(20),
    db.select().from(jobFailures).where(isNull(jobFailures.resolvedAt)).orderBy(desc(jobFailures.createdAt)).limit(20),
  ]);

  return {
    money: {
      authorizedMinor: n(m.authorized),
      heldMinor: n(m.held),
      capturedMinor: n(m.captured),
      voidedMinor: n(m.voided),
      paidOutMinor: n(m.paid_out),
      paypalFeesMinor: n(m.paypal_fees),
    },
    fundings: fundingRows,
    settlements: settlementRows,
    payouts: payoutRows,
    failedWebhooks,
    deadJobs,
  };
}
