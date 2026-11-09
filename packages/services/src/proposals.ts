import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { AppError, bpsToPercent, formatMoney, type ComputedProposal } from "@ahadi/core";
import { getEnv, getPolicy } from "@ahadi/core/env";
import { anthropicConfigured, explainProposal, type Explanation } from "@ahadi/agents";
import {
  criteria,
  criterionResults,
  getDb,
  milestones,
  promises,
  proposals,
  submissions,
  verifications,
  type Proposal,
} from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import { enqueue } from "@ahadi/queue";
import { actorTag, assertParty, isAdmin, SYSTEM, type Actor } from "./actor";
import { templateExplanation } from "./explain";
import { log } from "./log";
import { openMediation } from "./mediation";
import { notify } from "./notify";
import { applyMilestoneEvent, lockMilestone } from "./transitions";

/** Publish a computed proposal and start the objection window (SPEC §7.3, §17 settlement.propose). */
export async function publishProposal(
  verificationId: string,
  computed: ComputedProposal,
  opts: { mediationId?: string } = {},
): Promise<Proposal> {
  const db = getDb();
  const env = getEnv();
  const policy = getPolicy(env);
  const [v] = await db.select().from(verifications).where(eq(verifications.id, verificationId));
  const [sub] = await db.select().from(submissions).where(eq(submissions.id, v!.submissionId));
  const [ms] = await db.select().from(milestones).where(eq(milestones.id, sub!.milestoneId));
  const [promise] = await db.select().from(promises).where(eq(promises.id, ms!.promiseId));
  const crit = await db
    .select()
    .from(criteria)
    .where(eq(criteria.milestoneId, ms!.id))
    .orderBy(asc(criteria.key));
  const results = await db
    .select()
    .from(criterionResults)
    .where(eq(criterionResults.verificationId, verificationId));
  const titles = Object.fromEntries(crit.map((c) => [c.key, c.spec.title]));
  const windowEndsAt = new Date(Date.now() + policy.objectionWindowMs);
  const explanation = templateExplanation({
    proposal: computed,
    amountMinor: ms!.amountMinor,
    currency: promise!.currency,
    titles,
  });

  // Supersede any previous active proposal for this verification (mediation recompute).
  const prior = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.verificationId, verificationId), isNull(proposals.supersededAt)));
  const proposalVerificationId = prior.length
    ? await cloneVerificationForRecompute(verificationId)
    : verificationId;

  const [proposal] = await db.transaction(async (tx) => {
    for (const p of prior)
      await tx.update(proposals).set({ supersededAt: new Date() }).where(eq(proposals.id, p.id));
    const rows = await tx
      .insert(proposals)
      .values({
        verificationId: proposalVerificationId,
        releaseBps: computed.releaseBps,
        captureMinor: computed.captureMinor,
        platformFeeMinor: computed.platformFeeMinor,
        requiresHumanConfirm: computed.requiresHumanConfirm,
        blockedReason: computed.blockedReason,
        explanation,
        windowEndsAt,
        mediationId: opts.mediationId ?? null,
        // SPEC §7.3: worker decision not required at 100%, client decision not required at 0%.
        workerDecision: computed.releaseBps === 10000 ? "accept" : null,
        clientDecision: computed.releaseBps === 0 ? "accept" : null,
      })
      .returning();
    const { milestone } = await lockMilestone(tx, ms!.id);
    if (milestone.state === "VERDICT_READY") {
      await applyMilestoneEvent(tx, {
        milestoneId: ms!.id,
        event: "PROPOSAL_PUBLISHED",
        actor: SYSTEM,
        payload: {
          proposalId: rows[0]!.id,
          releaseBps: computed.releaseBps,
          captureMinor: computed.captureMinor,
          platformFeeMinor: computed.platformFeeMinor,
          windowEndsAt: windowEndsAt.toISOString(),
          mediationId: opts.mediationId ?? null,
        },
      });
    } else {
      await appendLedgerEvent(tx, {
        promiseId: promise!.id,
        type: "proposal.published",
        actor: "system",
        payload: {
          milestoneId: ms!.id,
          proposalId: rows[0]!.id,
          releaseBps: computed.releaseBps,
          captureMinor: computed.captureMinor,
          windowEndsAt: windowEndsAt.toISOString(),
          mediationId: opts.mediationId ?? null,
        },
      });
    }
    return rows;
  });

  // Explanations (Haiku). Amounts in text must match the facts; numbers in the UI come from the row.
  if (anthropicConfigured()) {
    const facts = {
      milestone: ms!.title,
      "milestone amount": formatMoney(ms!.amountMinor, promise!.currency),
      "release percent": bpsToPercent(computed.releaseBps),
      "release amount": formatMoney(computed.captureMinor, promise!.currency),
      "returned to client": formatMoney(ms!.amountMinor - computed.captureMinor, promise!.currency),
      "platform fee": formatMoney(computed.platformFeeMinor, promise!.currency),
      "worker receives before PayPal fees": formatMoney(computed.workerEstimateMinor, promise!.currency),
      "blocked reason": computed.blockedReason ?? "none",
    };
    const crits = crit.map((c) => {
      const r = results.find((x) => x.criterionId === c.id);
      return {
        title: c.spec.title,
        weight: c.weight,
        outcome: r?.outcome,
        credit: r?.credit,
        reasoning: r?.reasoning,
        howToFix: r?.howToFix,
      };
    });
    const [client, worker] = await Promise.all(
      (["client", "worker"] as const).map((audience) =>
        explainProposal({
          proposalId: proposal!.id,
          audience,
          facts,
          criteria: crits,
          windowEndsAt: windowEndsAt.toISOString(),
        }).catch((e) => {
          log.warn(
            { proposal_id: proposal!.id, err: (e as Error).message },
            "explainer failed; template explanation used",
          );
          return null as Explanation | null;
        }),
      ),
    );
    await db
      .update(proposals)
      .set({ explanationClient: client, explanationWorker: worker })
      .where(eq(proposals.id, proposal!.id));
  }

  await enqueue(
    "objection.expire",
    { proposalId: proposal!.id },
    { delay: Math.max(1000, policy.objectionWindowMs) },
  );
  const link = `/promises/${promise!.id}/verify?milestone=${ms!.id}`;
  const headline = `${bpsToPercent(computed.releaseBps)} release proposed: ${formatMoney(computed.captureMinor, promise!.currency)} of ${formatMoney(ms!.amountMinor, promise!.currency)}`;
  await notify({
    userId: promise!.clientUserId,
    template: "verdict_ready",
    title: `Verdict ready: ${promise!.title}`,
    body: `${headline}. Accept or object before ${windowEndsAt.toUTCString()}.`,
    link,
    promiseId: promise!.id,
  });
  await notify({
    userId: promise!.workerUserId,
    template: "verdict_ready",
    title: `Verdict ready: ${promise!.title}`,
    body: `${headline}. Accept, resubmit or object before ${windowEndsAt.toUTCString()}.`,
    link,
    promiseId: promise!.id,
  });
  if (promise!.workerAgentId)
    await enqueue("provider.dispatch", { promiseId: promise!.id, milestoneId: ms!.id, event: "job.verdict" });
  return proposal!;
}

/**
 * A recomputed proposal (mediation adjustment) needs its own verification row because proposals
 * are unique per verification. The copy carries the adjusted criterion results.
 */
async function cloneVerificationForRecompute(verificationId: string): Promise<string> {
  const db = getDb();
  const [v] = await db.select().from(verifications).where(eq(verifications.id, verificationId));
  const rows = await db
    .select()
    .from(criterionResults)
    .where(eq(criterionResults.verificationId, verificationId));
  const [copy] = await db
    .insert(verifications)
    .values({
      submissionId: v!.submissionId,
      termsVersionId: v!.termsVersionId,
      status: "COMPLETE",
      stage: "done",
      injectionFlagged: v!.injectionFlagged,
      injectionReport: v!.injectionReport,
      summary: `Recomputed after mediation. ${v!.summary ?? ""}`,
      evidence: v!.evidence,
      finishedAt: new Date(),
    })
    .returning();
  if (rows.length)
    await db
      .insert(criterionResults)
      .values(rows.map(({ id: _id, verificationId: _v, ...r }) => ({ ...r, verificationId: copy!.id })));
  return copy!.id;
}

/* ─────────────── Decisions (SPEC §16 POST /api/milestones/:id/decision) ─────────────── */

export const DecisionInput = z.object({
  decision: z.enum(["accept", "object", "resubmit"]),
  reason: z.string().trim().max(4000).optional(),
});

export async function activeProposal(milestoneId: string): Promise<Proposal | undefined> {
  const rows = await getDb()
    .select({ p: proposals })
    .from(proposals)
    .innerJoin(verifications, eq(verifications.id, proposals.verificationId))
    .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
    .where(and(eq(submissions.milestoneId, milestoneId), isNull(proposals.supersededAt)))
    .orderBy(desc(proposals.createdAt))
    .limit(1);
  return rows[0]?.p;
}

export async function recordDecision(actor: Actor, milestoneId: string, raw: unknown) {
  const { decision, reason } = DecisionInput.parse(raw);
  const db = getDb();
  const [ms] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!ms) throw new AppError("NOT_FOUND", "Milestone not found");
  const [promise] = await db.select().from(promises).where(eq(promises.id, ms.promiseId));
  const role = assertParty(actor, promise!);
  if (ms.state !== "OBJECTION_WINDOW")
    throw new AppError("CONFLICT", `No decision is open (milestone is ${ms.state.toLowerCase()})`);
  const proposal = await activeProposal(milestoneId);
  if (!proposal) throw new AppError("NOT_FOUND", "No active proposal");

  if (decision === "resubmit") {
    if (role !== "worker") throw new AppError("FORBIDDEN", "Only the worker can choose to resubmit");
    if (ms.attemptsUsed >= ms.maxAttempts) throw new AppError("CONFLICT", "No attempts left");
    await db.transaction(async (tx) => {
      await tx
        .update(proposals)
        .set({ workerDecision: "resubmit", supersededAt: new Date() })
        .where(eq(proposals.id, proposal.id));
      await applyMilestoneEvent(tx, {
        milestoneId,
        event: "RESUBMIT_CHOSEN",
        actor,
        payload: {
          proposalId: proposal.id,
          party: role,
          decision,
          attemptsLeft: ms.maxAttempts - ms.attemptsUsed,
        },
      });
    });
    await notify({
      userId: promise!.clientUserId,
      template: "generic",
      title: `The worker will resubmit: ${promise!.title}`,
      body: `They have ${ms.maxAttempts - ms.attemptsUsed} attempt(s) left. Funds stay held by PayPal.`,
      link: `/promises/${promise!.id}`,
      promiseId: promise!.id,
    });
    return { status: "FUNDED" };
  }

  if (decision === "object") {
    if (!reason || reason.length < 10)
      throw new AppError("VALIDATION_FAILED", "Explain what you disagree with (at least a sentence)");
    await db.transaction(async (tx) => {
      await tx
        .update(proposals)
        .set(role === "client" ? { clientDecision: "object" } : { workerDecision: "object" })
        .where(eq(proposals.id, proposal.id));
    });
    const mediation = await openMediation(actor, milestoneId, reason, proposal.id);
    return { status: "MEDIATING", mediationId: mediation.id };
  }

  // accept
  if (role === "worker" && proposal.releaseBps === 10000) return { status: "OBJECTION_WINDOW" };
  await db.transaction(async (tx) => {
    await tx
      .update(proposals)
      .set(role === "client" ? { clientDecision: "accept" } : { workerDecision: "accept" })
      .where(eq(proposals.id, proposal.id));
    await appendLedgerEvent(tx, {
      promiseId: promise!.id,
      type: "decision.recorded",
      actor: actorTag(actor),
      payload: { milestoneId, proposalId: proposal.id, party: role, decision: "accept" },
    });
  });
  const settled = await maybeApprove(proposal.id, "decision");
  return { status: settled ? "SETTLING" : "OBJECTION_WINDOW" };
}

/** Both required parties accepted → SETTLING (SPEC §7.3). */
async function maybeApprove(proposalId: string, trigger: "decision" | "window_expired"): Promise<boolean> {
  const db = getDb();
  const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
  if (!p || p.supersededAt) return false;
  const clientOk = p.clientDecision === "accept";
  const workerOk = p.workerDecision === "accept";
  const windowOver = p.windowEndsAt ? p.windowEndsAt <= new Date() : false;

  let approve = false;
  if (clientOk && workerOk) approve = true;
  else if (windowOver && trigger === "window_expired") {
    if (p.clientDecision === "object" || p.workerDecision === "object") approve = false;
    // Auto-accept on expiry, unless above the human-confirmation threshold and the client hasn't confirmed.
    else if (p.requiresHumanConfirm && !clientOk) approve = false;
    else approve = true;
  } else if (clientOk && p.releaseBps === 10000) approve = true;

  if (!approve) return false;
  const [v] = await db.select().from(verifications).where(eq(verifications.id, p.verificationId));
  const [sub] = await db.select().from(submissions).where(eq(submissions.id, v!.submissionId));
  const ok = await db.transaction(async (tx) => {
    const { milestone } = await lockMilestone(tx, sub!.milestoneId);
    if (milestone.state !== "OBJECTION_WINDOW") return false;
    await applyMilestoneEvent(tx, {
      milestoneId: sub!.milestoneId,
      event: "SETTLEMENT_APPROVED",
      actor: SYSTEM,
      payload: {
        proposalId,
        trigger,
        clientDecision: p.clientDecision ?? (trigger === "window_expired" ? "auto_accept" : null),
        workerDecision: p.workerDecision ?? (trigger === "window_expired" ? "auto_accept" : null),
        releaseBps: p.releaseBps,
      },
    });
    return true;
  });
  if (ok) await enqueue("settlement.execute", { proposalId });
  return ok;
}

/** objection.expire (delayed job at window_ends_at). */
export async function expireObjectionWindow(proposalId: string) {
  const db = getDb();
  const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
  if (!p || p.supersededAt) return "superseded";
  if (p.windowEndsAt && p.windowEndsAt > new Date()) return "not_yet";
  const approved = await maybeApprove(proposalId, "window_expired");
  if (!approved && p.requiresHumanConfirm && p.clientDecision !== "accept") {
    const [v] = await db.select().from(verifications).where(eq(verifications.id, p.verificationId));
    const [sub] = await db.select().from(submissions).where(eq(submissions.id, v!.submissionId));
    const [ms] = await db.select().from(milestones).where(eq(milestones.id, sub!.milestoneId));
    const [promise] = await db.select().from(promises).where(eq(promises.id, ms!.promiseId));
    await notify({
      userId: promise!.clientUserId,
      template: "verdict_ready",
      title: `Confirmation needed: ${promise!.title}`,
      body: `This release (${formatMoney(p.captureMinor, promise!.currency)}) is above the automatic limit, so it waits for your explicit confirmation.`,
      link: `/promises/${promise!.id}/verify?milestone=${ms!.id}`,
      promiseId: promise!.id,
    });
    return "waiting_for_confirmation";
  }
  return approved ? "auto_accepted" : "open";
}

/** Safety net for lost delayed jobs: every minute, expire windows that passed. */
export async function sweepObjectionWindows() {
  const db = getDb();
  const due = await db
    .select({ id: proposals.id })
    .from(proposals)
    .innerJoin(verifications, eq(verifications.id, proposals.verificationId))
    .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
    .innerJoin(milestones, eq(milestones.id, submissions.milestoneId))
    .where(
      and(
        isNull(proposals.supersededAt),
        lte(proposals.windowEndsAt, new Date()),
        eq(milestones.state, "OBJECTION_WINDOW"),
      ),
    )
    .limit(50);
  let n = 0;
  for (const d of due) if ((await expireObjectionWindow(d.id)) === "auto_accepted") n++;
  return { checked: due.length, autoAccepted: n };
}

export function canDecide(actor: Actor) {
  return actor.kind === "user" || actor.kind === "agent" || isAdmin(actor);
}
