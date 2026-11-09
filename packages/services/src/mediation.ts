import { createHash } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { AppError, bpsToPercent, computeProposal, formatMoney } from "@ahadi/core";
import { getEnv, getPolicy } from "@ahadi/core/env";
import { anthropicConfigured, mediate, MediationResult } from "@ahadi/agents";
import {
  criteria,
  criterionResults,
  getDb,
  ledgerEvents,
  mediations,
  milestones,
  promises,
  proposals,
  termsVersions,
  verifications,
  type Mediation,
} from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import { enqueue } from "@ahadi/queue";
import { actorTag, assertAdmin, assertParty, isAdmin, partyRole, SYSTEM, type Actor } from "./actor";
import { log } from "./log";
import { notify } from "./notify";
import { applyMilestoneEvent, applyPromiseEvent, lockMilestone } from "./transitions";

const STATEMENT_WAIT_MS = 24 * 3600 * 1000;

/** Objection → MEDIATING (SPEC §7.3, AGENT_PROMPTS §7). */
export async function openMediation(
  actor: Actor,
  milestoneId: string,
  statement: string,
  proposalId: string,
): Promise<Mediation> {
  const db = getDb();
  const m = await db.transaction(async (tx) => {
    const { milestone, promise } = await lockMilestone(tx, milestoneId);
    const role = assertParty(actor, promise);
    if (milestone.state !== "OBJECTION_WINDOW") throw new AppError("CONFLICT", "Nothing to object to");
    const [row] = await tx
      .insert(mediations)
      .values({
        milestoneId,
        openedBy: role,
        proposalId,
        ...(role === "client" ? { clientStatement: statement } : { workerStatement: statement }),
      })
      .returning();
    await applyMilestoneEvent(tx, {
      milestoneId,
      event: "OBJECTION_RAISED",
      actor,
      payload: { mediationId: row!.id, proposalId, party: role, statementSha: hashText(statement) },
    });
    if (promise.state === "ACTIVE")
      await applyPromiseEvent(tx, {
        promiseId: promise.id,
        event: "MEDIATION_OPENED",
        actor,
        ledgerType: "promise.disputed",
        payload: { mediationId: row!.id },
      });
    return { row: row!, promise, role };
  });
  // The mediator runs when both statements are in, or 24h after opening.
  await enqueue("mediation.run", { mediationId: m.row.id }, { delay: STATEMENT_WAIT_MS });
  const other = m.role === "client" ? m.promise.workerUserId : m.promise.clientUserId;
  await notify({
    userId: other,
    template: "mediation_update",
    title: `Objection raised: ${m.promise.title}`,
    body: `The ${m.role} objected to the proposed release. Add your side within 24 hours; then the Ahadi Mediator proposes a resolution. Funds stay held by PayPal.`,
    link: `/promises/${m.promise.id}/mediation?milestone=${milestoneId}`,
    promiseId: m.promise.id,
  });
  return m.row;
}

export async function addStatement(actor: Actor, mediationId: string, statement: string) {
  const text = z.string().trim().min(10).max(4000).parse(statement);
  const db = getDb();
  const { m, promise } = await loadMediation(mediationId);
  const role = assertParty(actor, promise);
  if (m.status !== "OPEN") throw new AppError("CONFLICT", "Statements are closed for this round");
  await db.transaction(async (tx) => {
    await tx
      .update(mediations)
      .set(role === "client" ? { clientStatement: text } : { workerStatement: text })
      .where(eq(mediations.id, mediationId));
    await appendLedgerEvent(tx, {
      promiseId: promise.id,
      type: "mediation.statement",
      actor: actorTag(actor),
      payload: { mediationId, party: role, statementSha: hashText(text) },
    });
  });
  const [fresh] = await db.select().from(mediations).where(eq(mediations.id, mediationId));
  if (fresh!.clientStatement && fresh!.workerStatement)
    await enqueue(
      "mediation.run",
      { mediationId },
      { jobId: `mediation-${mediationId}-r${fresh!.rejections}-both` },
    );
}

/** mediation.run job: Mediator agent → resolution with recomputed numbers (not yet applied). */
export async function runMediation(mediationId: string) {
  const db = getDb();
  const { m, promise, milestone } = await loadMediation(mediationId);
  if (m.status !== "OPEN") return "not_open";
  if (milestone.state !== "MEDIATING") return "milestone_not_mediating";
  await db.update(mediations).set({ status: "RUNNING" }).where(eq(mediations.id, mediationId));
  try {
    const ctx = await mediationContext(m);
    if (!anthropicConfigured()) {
      await db
        .update(mediations)
        .set({
          status: "PROPOSED",
          aiResolution: {
            pendingAdmin: true,
            note: "AI mediation is not configured; an Ahadi admin will propose a resolution.",
          },
        })
        .where(eq(mediations.id, mediationId));
      return "awaiting_admin";
    }
    const result = await mediate({
      mediationId,
      terms: ctx.terms,
      verification: ctx.verification,
      proposal: ctx.proposalFacts,
      clientStatement: m.clientStatement,
      workerStatement: m.workerStatement,
      newEvidence: "",
      timeline: ctx.timeline,
      criterionIds: ctx.crit.map((c) => c.key),
    });
    await storeResolution(m, result, ctx);
    return result.resolution;
  } catch (e) {
    log.error({ mediation_id: mediationId, err: (e as Error).message }, "mediation failed");
    await db.update(mediations).set({ status: "OPEN" }).where(eq(mediations.id, mediationId));
    throw e;
  }
}

/** Admin proposes a resolution manually (no AI, or overriding a poor one). */
export async function adminProposeResolution(actor: Actor, mediationId: string, raw: unknown) {
  assertAdmin(actor);
  const result = MediationResult.parse(raw);
  const { m } = await loadMediation(mediationId);
  if (!["OPEN", "PROPOSED"].includes(m.status)) throw new AppError("CONFLICT", "Mediation is closed");
  await storeResolution(m, result, await mediationContext(m), actorTag(actor));
}

async function storeResolution(
  m: Mediation,
  result: MediationResult,
  ctx: Awaited<ReturnType<typeof mediationContext>>,
  by = "agent:mediator",
) {
  const db = getDb();
  let recomputed: {
    releaseBps: number;
    captureMinor: number;
    platformFeeMinor: number;
    kind: string;
    blockedReason: string | null;
  } | null = null;
  if (result.resolution === "adjust") {
    const adjusted = ctx.crit.map((c) => {
      const r = ctx.results.find((x) => x.criterionId === c.id)!;
      const adj = result.adjustments.find((a) => a.criterionId === c.key);
      return {
        criterionId: c.key,
        outcome: adj?.newOutcome ?? r.outcome,
        credit: adj ? adj.newCredit : r.credit,
        confidence: 1,
      };
    });
    const p = computeProposal({
      milestoneAmountMinor: ctx.milestone.amountMinor,
      criteria: ctx.crit.map((c) => ({
        id: c.key,
        weight: c.weight,
        required: c.required,
        partialCredit: c.spec.partialCredit,
      })),
      results: adjusted,
      injectionFlagged: false,
      policy: getPolicy(getEnv()),
    });
    recomputed = {
      releaseBps: p.releaseBps,
      captureMinor: p.captureMinor,
      platformFeeMinor: p.platformFeeMinor,
      kind: p.kind,
      blockedReason: p.blockedReason,
    };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(mediations)
      .set({
        status: "PROPOSED",
        aiResolution: { ...result, recomputed, proposedBy: by },
        clientDecision: null,
        workerDecision: null,
      })
      .where(eq(mediations.id, m.id));
    await appendLedgerEvent(tx, {
      promiseId: ctx.promise.id,
      type: "mediation.proposed",
      actor: by,
      payload: {
        mediationId: m.id,
        resolution: result.resolution,
        adjustments: result.adjustments.map((a) => ({
          criterion: a.criterionId,
          outcome: a.newOutcome,
          credit: a.newCredit,
        })),
        recomputed,
      },
    });
  });
  if (result.resolution === "escalate") {
    await escalate(
      m.id,
      result.escalationReason ?? "The mediator could not settle the facts from the evidence.",
    );
    return;
  }
  for (const uid of [ctx.promise.clientUserId, ctx.promise.workerUserId]) {
    await notify({
      userId: uid,
      template: "mediation_update",
      title: `Mediator's proposal: ${ctx.promise.title}`,
      body: describeResolution(result.resolution, recomputed, ctx),
      link: `/promises/${ctx.promise.id}/mediation?milestone=${ctx.milestone.id}`,
      promiseId: ctx.promise.id,
    });
  }
}

function describeResolution(
  res: string,
  rec: { releaseBps: number; captureMinor: number } | null,
  ctx: Awaited<ReturnType<typeof mediationContext>>,
) {
  if (res === "uphold")
    return `Keep the original proposal (${ctx.proposalFacts.releasePct}, ${ctx.proposalFacts.capture}). Accept or reject.`;
  if (res === "adjust" && rec)
    return `Adjusted release: ${bpsToPercent(rec.releaseBps)} = ${formatMoney(rec.captureMinor, ctx.promise.currency)}. Accept or reject.`;
  if (res === "resubmit")
    return "The worker gets one more attempt with a specific fix list. Funds stay held. Accept or reject.";
  return "Escalated.";
}

export const MediationDecisionInput = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string().trim().max(2000).optional(),
});

/** Both accept → apply; any reject → another round; two rejections → ESCALATED. */
export async function decideMediation(actor: Actor, mediationId: string, raw: unknown) {
  const { decision, reason } = MediationDecisionInput.parse(raw);
  const db = getDb();
  const { m, promise, milestone } = await loadMediation(mediationId);
  const role = assertParty(actor, promise);
  if (m.status !== "PROPOSED" || (m.aiResolution as { pendingAdmin?: boolean } | null)?.pendingAdmin)
    throw new AppError("CONFLICT", "No resolution to decide on yet");
  await db.transaction(async (tx) => {
    await tx
      .update(mediations)
      .set(role === "client" ? { clientDecision: decision } : { workerDecision: decision })
      .where(eq(mediations.id, mediationId));
    await appendLedgerEvent(tx, {
      promiseId: promise.id,
      type: "mediation.decision",
      actor: actorTag(actor),
      payload: { mediationId, party: role, decision, reason: reason?.slice(0, 500) ?? null },
    });
  });
  const [fresh] = await db.select().from(mediations).where(eq(mediations.id, mediationId));
  if (decision === "reject") {
    const rejections = fresh!.rejections + 1;
    if (rejections >= 2) {
      await db.update(mediations).set({ rejections }).where(eq(mediations.id, mediationId));
      await escalate(mediationId, "The parties rejected the mediator's proposal twice.");
      return { status: "ESCALATED" };
    }
    await db
      .update(mediations)
      .set({ rejections, status: "OPEN", clientDecision: null, workerDecision: null })
      .where(eq(mediations.id, mediationId));
    await enqueue(
      "mediation.run",
      { mediationId },
      { jobId: `mediation-${mediationId}-r${rejections}`, delay: STATEMENT_WAIT_MS },
    );
    const other = role === "client" ? promise.workerUserId : promise.clientUserId;
    await notify({
      userId: other,
      template: "mediation_update",
      title: `Proposal rejected: ${promise.title}`,
      body: "One more mediation round opens. Add anything the mediator missed within 24 hours. A second rejection escalates to PayPal's dispute process.",
      link: `/promises/${promise.id}/mediation?milestone=${milestone.id}`,
      promiseId: promise.id,
    });
    return { status: "MEDIATING" };
  }
  if (fresh!.clientDecision === "accept" && fresh!.workerDecision === "accept")
    return applyResolution(fresh!);
  return { status: "MEDIATING" };
}

async function applyResolution(m: Mediation) {
  const db = getDb();
  const res = m.aiResolution as
    | (MediationResult & {
        recomputed: { releaseBps: number; captureMinor: number; platformFeeMinor: number } | null;
      })
    | null;
  if (!res) throw new AppError("CONFLICT", "No resolution");
  const ctx = await mediationContext(m);
  if (res.resolution === "resubmit") {
    await db.transaction(async (tx) => {
      await tx
        .update(mediations)
        .set({ status: "CLOSED", outcome: "resubmit", closedAt: new Date() })
        .where(eq(mediations.id, m.id));
      await tx.update(proposals).set({ supersededAt: new Date() }).where(eq(proposals.id, m.proposalId!));
      const { milestone } = await lockMilestone(tx, ctx.milestone.id);
      // "The worker gets one more attempt" — even if attempts were used up.
      const patch =
        milestone.attemptsUsed >= milestone.maxAttempts
          ? { attemptsUsed: milestone.maxAttempts - 1 }
          : undefined;
      await applyMilestoneEvent(tx, {
        milestoneId: milestone.id,
        event: "MEDIATION_RESUBMIT",
        actor: SYSTEM,
        patch,
        payload: { mediationId: m.id, fixList: res.resubmitFixList ?? [] },
      });
      if (ctx.promise.state === "DISPUTED")
        await applyPromiseEvent(tx, {
          promiseId: ctx.promise.id,
          event: "MEDIATION_RESOLVED",
          actor: SYSTEM,
          ledgerType: "promise.dispute_resolved",
        });
    });
    return { status: "FUNDED" };
  }

  // uphold or adjust → settle on the agreed numbers.
  let proposalId = m.proposalId!;
  if (res.resolution === "adjust" && res.recomputed) {
    const [old] = await db.select().from(proposals).where(eq(proposals.id, proposalId));
    const [v] = await db.select().from(verifications).where(eq(verifications.id, old!.verificationId));
    const results = await db
      .select()
      .from(criterionResults)
      .where(eq(criterionResults.verificationId, v!.id));
    const [copy] = await db
      .insert(verifications)
      .values({
        submissionId: v!.submissionId,
        termsVersionId: v!.termsVersionId,
        status: "COMPLETE",
        stage: "done",
        summary: `Adjusted by mediation ${m.id}`,
        evidence: v!.evidence,
        finishedAt: new Date(),
      })
      .returning();
    await db.insert(criterionResults).values(
      results.map(({ id: _id, verificationId: _vid, ...r }) => {
        const c = ctx.crit.find((x) => x.id === r.criterionId)!;
        const adj = res.adjustments.find((a) => a.criterionId === c.key);
        return adj
          ? {
              ...r,
              verificationId: copy!.id,
              outcome: adj.newOutcome,
              credit: adj.newCredit,
              confidence: 1,
              decidedBy: "human" as const,
              reasoning: `Mediation: ${adj.reason}`,
            }
          : { ...r, verificationId: copy!.id };
      }),
    );
    const [np] = await db
      .insert(proposals)
      .values({
        verificationId: copy!.id,
        releaseBps: res.recomputed.releaseBps,
        captureMinor: res.recomputed.captureMinor,
        platformFeeMinor: res.recomputed.platformFeeMinor,
        explanation: res.messageToParties.slice(0, 1200),
        clientDecision: "accept",
        workerDecision: "accept",
        windowEndsAt: new Date(),
        mediationId: m.id,
      })
      .returning();
    await db.update(proposals).set({ supersededAt: new Date() }).where(eq(proposals.id, proposalId));
    proposalId = np!.id;
  } else {
    await db
      .update(proposals)
      .set({ clientDecision: "accept", workerDecision: "accept" })
      .where(eq(proposals.id, proposalId));
  }
  await db.transaction(async (tx) => {
    await tx
      .update(mediations)
      .set({ status: "CLOSED", outcome: "accepted", resolutionProposalId: proposalId, closedAt: new Date() })
      .where(eq(mediations.id, m.id));
    const { milestone } = await lockMilestone(tx, ctx.milestone.id);
    await applyMilestoneEvent(tx, {
      milestoneId: milestone.id,
      event: "MEDIATION_ACCEPTED",
      actor: SYSTEM,
      payload: { mediationId: m.id, resolution: res.resolution, proposalId },
    });
    const [p] = await tx.select().from(promises).where(eq(promises.id, ctx.promise.id));
    if (p!.state === "DISPUTED")
      await applyPromiseEvent(tx, {
        promiseId: p!.id,
        event: "MEDIATION_RESOLVED",
        actor: SYSTEM,
        ledgerType: "promise.dispute_resolved",
      });
  });
  await enqueue("settlement.execute", { proposalId });
  return { status: "SETTLING" };
}

/** MEDIATING → ESCALATED (terminal). Funds stay authorized until an admin acts or the hold expires. */
async function escalate(mediationId: string, reason: string) {
  const db = getDb();
  const { m, promise, milestone } = await loadMediation(mediationId);
  await db.transaction(async (tx) => {
    await tx
      .update(mediations)
      .set({ status: "CLOSED", outcome: "escalated", closedAt: new Date() })
      .where(eq(mediations.id, mediationId));
    const locked = await lockMilestone(tx, milestone.id);
    if (locked.milestone.state === "MEDIATING")
      await applyMilestoneEvent(tx, {
        milestoneId: milestone.id,
        event: "MEDIATION_ESCALATED",
        actor: SYSTEM,
        payload: { mediationId, reason, rejections: m.rejections },
      });
    const [p] = await tx.select().from(promises).where(eq(promises.id, promise.id));
    if (p!.state === "DISPUTED")
      await applyPromiseEvent(tx, {
        promiseId: p!.id,
        event: "MEDIATION_RESOLVED",
        actor: SYSTEM,
        ledgerType: "promise.dispute_escalated",
      });
  });
  for (const uid of [promise.clientUserId, promise.workerUserId]) {
    await notify({
      userId: uid,
      template: "mediation_update",
      title: `Escalated: ${promise.title}`,
      body: `${reason} An Ahadi reviewer has the full evidence pack and will contact you. You can download it from the promise page.`,
      link: `/promises/${promise.id}/ledger`,
      promiseId: promise.id,
    });
  }
}

async function loadMediation(id: string) {
  const db = getDb();
  const [m] = await db.select().from(mediations).where(eq(mediations.id, id));
  if (!m) throw new AppError("NOT_FOUND", "Mediation not found");
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, m.milestoneId));
  const [promise] = await db.select().from(promises).where(eq(promises.id, milestone!.promiseId));
  return { m, milestone: milestone!, promise: promise! };
}

async function mediationContext(m: Mediation) {
  const db = getDb();
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, m.milestoneId));
  const [promise] = await db.select().from(promises).where(eq(promises.id, milestone!.promiseId));
  const [terms] = await db
    .select()
    .from(termsVersions)
    .where(eq(termsVersions.id, promise!.currentTermsVersionId!));
  const [proposal] = await db.select().from(proposals).where(eq(proposals.id, m.proposalId!));
  const results = await db
    .select()
    .from(criterionResults)
    .where(eq(criterionResults.verificationId, proposal!.verificationId));
  const crit = await db
    .select()
    .from(criteria)
    .where(eq(criteria.milestoneId, milestone!.id))
    .orderBy(asc(criteria.key));
  const events = await db
    .select()
    .from(ledgerEvents)
    .where(eq(ledgerEvents.promiseId, promise!.id))
    .orderBy(desc(ledgerEvents.seq))
    .limit(25);
  return {
    milestone: milestone!,
    promise: promise!,
    crit,
    results,
    terms: terms!.body.milestones.find((x) => x.position === milestone!.position) ?? terms!.body,
    verification: crit.map((c) => {
      const r = results.find((x) => x.criterionId === c.id);
      return {
        id: c.key,
        title: c.spec.title,
        description: c.spec.description,
        weight: c.weight,
        required: c.required,
        partialCredit: c.spec.partialCredit,
        outcome: r?.outcome,
        credit: r?.credit,
        confidence: r?.confidence,
        decidedBy: r?.decidedBy,
        reasoning: r?.reasoning,
      };
    }),
    proposalFacts: {
      releasePct: bpsToPercent(proposal!.releaseBps),
      capture: formatMoney(proposal!.captureMinor, promise!.currency),
      milestoneAmount: formatMoney(milestone!.amountMinor, promise!.currency),
    },
    timeline: events
      .reverse()
      .map((e) => `${e.createdAt.toISOString()} ${e.type}`)
      .join("\n"),
  };
}

export async function getMediationView(actor: Actor, milestoneId: string) {
  const db = getDb();
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, milestoneId));
  if (!milestone) throw new AppError("NOT_FOUND", "Milestone not found");
  const [promise] = await db.select().from(promises).where(eq(promises.id, milestone.promiseId));
  if (!isAdmin(actor) && !partyRole(actor, promise!)) throw new AppError("NOT_FOUND", "Milestone not found");
  const list = await db
    .select()
    .from(mediations)
    .where(eq(mediations.milestoneId, milestoneId))
    .orderBy(desc(mediations.createdAt));
  const props = list.length
    ? await db
        .select()
        .from(proposals)
        .where(inArray(proposals.id, list.map((m) => m.proposalId!).filter(Boolean)))
    : [];
  return {
    promise: promise!,
    milestone,
    role: partyRole(actor, promise!),
    isAdmin: isAdmin(actor),
    mediations: list,
    proposals: props,
  };
}

function hashText(t: string) {
  return createHash("sha256").update(t).digest("hex");
}
