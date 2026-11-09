import { eq } from "drizzle-orm";
import { AppError, bpsToPercent, fromPayPalValue, idempotencyKeys, toPayPalValue } from "@ahadi/core";
import { fundings, getDb, settlements, type Funding, type Settlement } from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import {
  PayPalError,
  captureAuthorization,
  getAuthorization,
  voidAuthorization,
  type Capture,
} from "@ahadi/paypal";
import { enqueue } from "@ahadi/queue";
import { SYSTEM } from "./actor";
import { loadProposalContext } from "./context";
import { getLiveFunding } from "./funding";
import { log } from "./log";
import { getPayPal } from "./paypal";
import { applyMilestoneEvent } from "./transitions";

export type SettlementOutcome = "captured" | "capture_pending" | "voided" | "already_done" | "failed";

/**
 * settlement.execute (SPEC §6.5, §17). Runs only in the worker. Captures the computed amount with
 * final_capture=true (PayPal releases the rest of the hold), or voids for a 0% release.
 * Retryable PayPal errors are re-thrown for BullMQ; everything else marks SETTLEMENT_FAILED.
 */
export async function executeSettlement(proposalId: string): Promise<SettlementOutcome> {
  const db = getDb();
  const ctx = await loadProposalContext(db, proposalId);
  const { proposal, milestone, promise } = ctx;

  if (ctx.settlement && ["CAPTURED", "VOIDED", "PAID"].includes(ctx.settlement.status)) return "already_done";
  if (milestone.state === "SETTLEMENT_FAILED") {
    await db.transaction((tx) => applyMilestoneEvent(tx, { milestoneId: milestone.id, event: "SETTLEMENT_RETRIED", actor: SYSTEM, payload: { proposalId } }));
  } else if (milestone.state !== "SETTLING") {
    throw new AppError("CONFLICT", `Milestone ${milestone.id} is ${milestone.state}, not SETTLING`);
  }

  const funding = await getLiveFunding(db, milestone.id);
  if (!funding?.paypalAuthorizationId) {
    await markFailed(proposalId, milestone.id, promise.id, { message: "No live PayPal authorization" });
    return "failed";
  }

  const settlement = await ensureSettlementRow(proposalId);
  const paypal = getPayPal();

  try {
    if (proposal.captureMinor === 0) {
      await voidAuthorization(paypal, funding.paypalAuthorizationId, idempotencyKeys.void(funding.paypalAuthorizationId));
      await recordVoid(settlement, funding, milestone.id, promise.id, "zero_release");
      return "voided";
    }

    if (proposal.captureMinor > funding.amountMinor) {
      throw new AppError("INTERNAL", "Refusing to capture more than authorized");
    }
    const isFull = proposal.captureMinor === funding.amountMinor;
    const res = await captureAuthorization(
      paypal,
      funding.paypalAuthorizationId,
      {
        amount: { currency_code: funding.currency, value: toPayPalValue(proposal.captureMinor, funding.currency) },
        finalCapture: true,
        invoiceId: `ahadi-${milestone.id}-a${ctx.submission.attempt}`,
        noteToPayer: isFull
          ? `Ahadi: all criteria verified for "${milestone.title}".`
          : `Ahadi: ${bpsToPercent(proposal.releaseBps)} of "${milestone.title}" released per your agreement. The rest of the hold is returned to you.`,
      },
      idempotencyKeys.capture(proposalId),
    );
    const outcome = await recordCapture(settlement.id, funding, res.data, { isFull, milestoneId: milestone.id, promiseId: promise.id });
    if (outcome === "captured" && !isFull) await releaseRemainderIfStillHeld(funding, promise.id, milestone.id);
    return outcome;
  } catch (e) {
    if (e instanceof PayPalError && e.retryable) throw e; // BullMQ backs off and retries with the same idempotency key
    const detail = e instanceof PayPalError ? e.toJSON() : { message: (e as Error).message };
    await markFailed(proposalId, milestone.id, promise.id, detail);
    log.error({ proposal_id: proposalId, milestone_id: milestone.id, err: detail }, "settlement failed");
    return "failed";
  }
}

async function ensureSettlementRow(proposalId: string): Promise<Settlement> {
  const db = getDb();
  const [created] = await db
    .insert(settlements)
    .values({ proposalId, status: "PENDING" })
    .onConflictDoNothing({ target: settlements.proposalId })
    .returning();
  if (created) return created;
  const [existing] = await db.select().from(settlements).where(eq(settlements.proposalId, proposalId));
  if (existing!.status === "FAILED") {
    const [reset] = await db.update(settlements).set({ status: "PENDING", error: null }).where(eq(settlements.id, existing!.id)).returning();
    return reset!;
  }
  return existing!;
}

/** Persist a capture result. Also used by the PAYMENT.CAPTURE.COMPLETED webhook for pending captures. */
export async function recordCapture(
  settlementId: string,
  funding: Funding,
  capture: Capture,
  ctx: { isFull: boolean; milestoneId: string; promiseId: string },
): Promise<SettlementOutcome> {
  const db = getDb();
  const captured = fromPayPalValue(capture.amount.value, capture.amount.currency_code);
  const fee = capture.seller_receivable_breakdown?.paypal_fee
    ? fromPayPalValue(capture.seller_receivable_breakdown.paypal_fee.value)
    : null;
  const net = capture.seller_receivable_breakdown?.net_amount
    ? fromPayPalValue(capture.seller_receivable_breakdown.net_amount.value)
    : fee !== null
      ? captured - fee
      : null;

  if (capture.status === "DECLINED" || capture.status === "FAILED") {
    const [s] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
    await markFailed(s!.proposalId, ctx.milestoneId, ctx.promiseId, { captureId: capture.id, status: capture.status, reason: capture.status_details?.reason });
    return "failed";
  }

  const pending = capture.status === "PENDING";
  await db.transaction(async (tx) => {
    await tx
      .update(settlements)
      .set({
        status: pending ? "CAPTURE_PENDING" : "CAPTURED",
        paypalCaptureId: capture.id,
        capturedMinor: captured,
        paypalFeeMinor: fee,
        netMinor: net,
      })
      .where(eq(settlements.id, settlementId));
    await tx
      .update(fundings)
      .set({ status: ctx.isFull ? "CAPTURED" : "PARTIALLY_CAPTURED" })
      .where(eq(fundings.id, funding.id));
    await appendLedgerEvent(tx, {
      promiseId: ctx.promiseId,
      type: pending ? "settlement.capture_pending" : "settlement.captured",
      actor: "paypal",
      payload: {
        milestoneId: ctx.milestoneId,
        captureId: capture.id,
        authorizationId: funding.paypalAuthorizationId,
        capturedMinor: captured,
        paypalFeeMinor: fee,
        netMinor: net,
        finalCapture: true,
        status: capture.status,
        pendingReason: capture.status_details?.reason ?? null,
      },
    });
  });
  if (pending) return "capture_pending";
  await enqueue("payout.send", { settlementId });
  return "captured";
}

/** SPEC §6.5: "If the remainder still shows as reserved after a final partial capture, call void explicitly." */
async function releaseRemainderIfStillHeld(funding: Funding, promiseId: string, milestoneId: string) {
  const paypal = getPayPal();
  try {
    const { data: auth } = await getAuthorization(paypal, funding.paypalAuthorizationId!);
    if (auth.status === "PARTIALLY_CAPTURED") {
      await voidAuthorization(paypal, auth.id, idempotencyKeys.void(auth.id));
      await getDb().transaction((tx) =>
        appendLedgerEvent(tx, {
          promiseId,
          type: "funding.remainder_voided",
          actor: "system",
          payload: { milestoneId, authorizationId: auth.id },
        }),
      );
    }
  } catch (e) {
    // Non-fatal: final_capture normally releases the remainder already.
    log.warn({ milestone_id: milestoneId, err: e instanceof PayPalError ? e.toJSON() : String(e) }, "remainder void check failed");
  }
}

export async function recordVoid(settlement: Settlement | null, funding: Funding, milestoneId: string, promiseId: string, reason: string) {
  const db = getDb();
  await db.transaction(async (tx) => {
    if (settlement) await tx.update(settlements).set({ status: "VOIDED", capturedMinor: 0 }).where(eq(settlements.id, settlement.id));
    await tx.update(fundings).set({ status: "VOIDED" }).where(eq(fundings.id, funding.id));
    await applyMilestoneEvent(tx, {
      milestoneId,
      event: "AUTHORIZATION_VOIDED",
      actor: SYSTEM,
      payload: { authorizationId: funding.paypalAuthorizationId, reason, settlementId: settlement?.id ?? null },
    });
  });
  log.info({ promise_id: promiseId, milestone_id: milestoneId, reason }, "authorization voided");
}

async function markFailed(proposalId: string, milestoneId: string, promiseId: string, error: Record<string, unknown>) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(settlements).where(eq(settlements.proposalId, proposalId));
    if (existing) await tx.update(settlements).set({ status: "FAILED", error }).where(eq(settlements.id, existing.id));
    else await tx.insert(settlements).values({ proposalId, status: "FAILED", error });
    await applyMilestoneEvent(tx, { milestoneId, event: "SETTLEMENT_FAILED", actor: SYSTEM, payload: { proposalId, error } });
  });
  void promiseId;
}
