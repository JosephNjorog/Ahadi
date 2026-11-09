import { asc, eq } from "drizzle-orm";
import { AppError, computeProposal, type Outcome } from "@ahadi/core";
import { getEnv, getPolicy } from "@ahadi/core/env";
import { criteria, criterionResults, getDb, proposals, submissions, verifications } from "@ahadi/db";
import { enqueue } from "@ahadi/queue";
import { assertAdmin, type Actor } from "./actor";
import { templateExplanation } from "./explain";
import { getLiveFunding } from "./funding";
import { log } from "./log";
import { applyMilestoneEvent, lockMilestone } from "./transitions";

export interface ManualVerdictInput {
  milestoneId: string;
  results: {
    criterionKey: string;
    outcome: Exclude<Outcome, "undetermined">;
    credit?: number;
    reasoning?: string;
  }[];
  note: string;
}

/**
 * Admin "manual verdict" — SPEC §25 Phase 1 exit ("capture X%"), and later the NEEDS_HUMAN review path.
 * It goes through the real pipeline: submission → verification → criterion results (decided_by human)
 * → settlement engine → proposal (both parties' decisions recorded as admin override) → SETTLING,
 * then the worker executes capture/void and payout. No shortcut touches PayPal from the web tier.
 */
export async function submitManualVerdict(actor: Actor, input: ManualVerdictInput) {
  assertAdmin(actor);
  if (!input.note.trim()) throw new AppError("VALIDATION_FAILED", "Add a note explaining the manual verdict");
  const db = getDb();
  const policy = getPolicy(getEnv());

  const result = await db.transaction(async (tx) => {
    const { milestone, promise } = await lockMilestone(tx, input.milestoneId);
    if (milestone.state !== "FUNDED")
      throw new AppError("CONFLICT", `Milestone must be FUNDED (is ${milestone.state})`);
    const funding = await getLiveFunding(tx, milestone.id);
    if (!funding) throw new AppError("CONFLICT", "No live PayPal authorization for this milestone");
    if (!promise.currentTermsVersionId) throw new AppError("CONFLICT", "Promise has no signed terms version");

    const rows = await tx
      .select()
      .from(criteria)
      .where(eq(criteria.milestoneId, milestone.id))
      .orderBy(asc(criteria.key));
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const given = new Map(input.results.map((r) => [r.criterionKey, r]));
    for (const k of given.keys())
      if (!byKey.has(k)) throw new AppError("VALIDATION_FAILED", `Unknown criterion ${k}`);
    for (const k of byKey.keys())
      if (!given.has(k)) throw new AppError("VALIDATION_FAILED", `Missing outcome for ${k}`);

    const attempt = milestone.attemptsUsed + 1;
    const [submission] = await tx
      .insert(submissions)
      .values({
        milestoneId: milestone.id,
        attempt,
        kind: "text",
        text: input.note,
        note: "Admin manual verdict",
        submittedByUserId: actor.kind === "user" ? actor.user.id : null,
      })
      .returning();
    await applyMilestoneEvent(tx, {
      milestoneId: milestone.id,
      event: "WORK_SUBMITTED",
      actor,
      patch: { attemptsUsed: attempt },
      payload: { submissionId: submission!.id, attempt, kind: "text", manual: true },
    });

    const [verification] = await tx
      .insert(verifications)
      .values({
        submissionId: submission!.id,
        termsVersionId: promise.currentTermsVersionId,
        status: "RUNNING",
        summary: `Manual verdict by admin: ${input.note}`,
      })
      .returning();
    await applyMilestoneEvent(tx, {
      milestoneId: milestone.id,
      event: "VERIFICATION_STARTED",
      actor,
      payload: { verificationId: verification!.id, manual: true },
    });

    const settlementResults = rows.map((r) => {
      const g = given.get(r.key)!;
      const credit =
        g.outcome === "pass" ? 1 : g.outcome === "fail" ? 0 : Math.min(0.95, Math.max(0.05, g.credit ?? 0.5));
      return {
        row: r,
        outcome: g.outcome,
        credit,
        reasoning: g.reasoning?.trim() || `Decided manually by admin.`,
      };
    });
    await tx.insert(criterionResults).values(
      settlementResults.map((s) => ({
        verificationId: verification!.id,
        criterionId: s.row.id,
        outcome: s.outcome,
        credit: s.credit,
        confidence: 1,
        decidedBy: "human" as const,
        reasoning: s.reasoning,
      })),
    );

    const computed = computeProposal({
      milestoneAmountMinor: milestone.amountMinor,
      criteria: rows.map((r) => ({
        id: r.key,
        weight: r.weight,
        required: r.required,
        partialCredit: r.spec.partialCredit,
      })),
      results: settlementResults.map((s) => ({
        criterionId: s.row.key,
        outcome: s.outcome,
        credit: s.credit,
        confidence: 1,
      })),
      injectionFlagged: false,
      policy,
    });
    if (computed.kind === "blocked")
      throw new AppError("CONFLICT", `Proposal blocked: ${computed.blockedReason}`);

    await tx
      .update(verifications)
      .set({ status: "COMPLETE", finishedAt: new Date() })
      .where(eq(verifications.id, verification!.id));

    const explanation = templateExplanation({
      proposal: computed,
      amountMinor: milestone.amountMinor,
      currency: promise.currency,
      titles: Object.fromEntries(rows.map((r) => [r.key, r.spec.title])),
    });
    const now = new Date();
    const [proposal] = await tx
      .insert(proposals)
      .values({
        verificationId: verification!.id,
        releaseBps: computed.releaseBps,
        captureMinor: computed.captureMinor,
        platformFeeMinor: computed.platformFeeMinor,
        requiresHumanConfirm: computed.requiresHumanConfirm,
        blockedReason: computed.blockedReason,
        explanation,
        clientDecision: "accept",
        workerDecision: "accept",
        windowEndsAt: now,
      })
      .returning();

    const verdictPayload = {
      verificationId: verification!.id,
      results: computed.breakdown.map((c) => ({
        criterion: c.id,
        outcome: c.outcome,
        creditPct: c.creditPct,
        confidence: c.confidence,
      })),
      decidedBy: "human",
    };
    await applyMilestoneEvent(tx, {
      milestoneId: milestone.id,
      event: "PROPOSAL_COMPUTED",
      actor,
      payload: verdictPayload,
    });
    await applyMilestoneEvent(tx, {
      milestoneId: milestone.id,
      event: "PROPOSAL_PUBLISHED",
      actor,
      payload: {
        proposalId: proposal!.id,
        releaseBps: computed.releaseBps,
        captureMinor: computed.captureMinor,
        platformFeeMinor: computed.platformFeeMinor,
        windowEndsAt: now.toISOString(),
      },
    });
    await applyMilestoneEvent(tx, {
      milestoneId: milestone.id,
      event: "SETTLEMENT_APPROVED",
      actor,
      payload: {
        proposalId: proposal!.id,
        party: "admin",
        decision: "accept",
        override: true,
        note: input.note,
      },
    });
    return { proposal: proposal!, computed, promiseId: promise.id };
  });

  await enqueue("settlement.execute", { proposalId: result.proposal.id });
  log.info(
    {
      milestone_id: input.milestoneId,
      proposal_id: result.proposal.id,
      release_bps: result.computed.releaseBps,
    },
    "manual verdict queued for settlement",
  );
  return result;
}
