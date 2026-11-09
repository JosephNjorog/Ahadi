import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { AppError, computePayoutPlan, formatMoney, idempotencyKeys, toPayPalValue } from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";
import { getDb, payouts, settlements, splits, users, type Payout } from "@ahadi/db";
import { appendLedgerEvent, maskEmail } from "@ahadi/ledger";
import { PayPalError, createPayoutBatch, getPayoutBatch, type PayoutItemStatus } from "@ahadi/paypal";
import { SYSTEM } from "./actor";
import { loadSettlementContext } from "./context";
import { log } from "./log";
import { getPayPal } from "./paypal";
import { payoutOnHold } from "./risk";
import { notify } from "./notify";
import { enqueue } from "@ahadi/queue";
import { applyMilestoneEvent } from "./transitions";

/**
 * payout.send (SPEC §6.6): after a capture completes, pay the worker and split recipients.
 * Idempotent: payout rows are keyed by sender_item_id and PayPal dedupes on sender_batch_id.
 */
export async function sendPayout(
  settlementId: string,
): Promise<{ status: "sent" | "already_sent" | "nothing_to_pay" }> {
  const db = getDb();
  const env = getEnv();
  const ctx = await loadSettlementContext(db, settlementId);
  const settlement = ctx.settlement!;
  const { milestone, promise } = ctx;
  if (settlement.status === "PAID") return { status: "already_sent" };
  if (settlement.status !== "CAPTURED")
    throw new AppError("CONFLICT", `Settlement is ${settlement.status}, not CAPTURED`);
  if (settlement.capturedMinor == null || settlement.netMinor == null)
    throw new AppError("CONFLICT", "Capture amounts not recorded yet");

  const existing = await db.select().from(payouts).where(eq(payouts.settlementId, settlementId));
  if (existing.some((p) => p.paypalPayoutBatchId)) return { status: "already_sent" };
  if (await payoutOnHold(promise.id))
    throw new AppError("CONFLICT", "Payout is on hold pending a risk review by an Ahadi admin");

  // Recipients: explicit team splits, else 100% to the worker's PayPal email.
  let recipients = (await db.select().from(splits).where(eq(splits.milestoneId, milestone.id))).map((s) => ({
    paypalEmail: s.recipientPaypalEmail,
    shareBps: s.shareBps,
    userId: s.recipientUserId,
  }));
  if (recipients.length === 0) {
    if (!promise.workerUserId) throw new AppError("CONFLICT", "Promise has no worker to pay");
    const [worker] = await db.select().from(users).where(eq(users.id, promise.workerUserId));
    const email = worker?.paypalEmail;
    if (!email) throw new AppError("CONFLICT", "The worker has not added a PayPal email for payouts");
    recipients = [{ paypalEmail: email, shareBps: 10000, userId: worker.id }];
  }

  const plan = computePayoutPlan({
    capturedMinor: settlement.capturedMinor,
    netMinor: settlement.netMinor,
    platformFeeBps: env.PLATFORM_FEE_BPS,
    recipients,
  });

  const batchId = idempotencyKeys.payoutBatch(settlementId);
  const lines = plan.lines
    .map((l, i) => ({ ...l, senderItemId: idempotencyKeys.payoutItem(settlementId, i) }))
    .filter((l) => l.amountMinor > 0);

  if (lines.length === 0) {
    await completeSettlement(settlementId, "nothing_to_pay");
    return { status: "nothing_to_pay" };
  }

  if (existing.length === 0) {
    await db
      .insert(payouts)
      .values(
        lines.map((l) => ({
          settlementId,
          recipientPaypalEmail: l.paypalEmail,
          amountMinor: l.amountMinor,
          currency: promise.currency,
          senderBatchId: batchId,
          senderItemId: l.senderItemId,
          status: "PENDING" as const,
        })),
      )
      .onConflictDoNothing({ target: payouts.senderItemId });
  }

  const criteriaNote =
    ctx.proposal.releaseBps === 10000
      ? "all criteria verified"
      : `${ctx.proposal.releaseBps / 100}% released after verification`;
  const res = await createPayoutBatch(getPayPal(), {
    senderBatchId: batchId,
    emailSubject: "You've been paid through Ahadi",
    emailMessage: `Your work on "${milestone.title}" was verified. Payment is on its way.`,
    items: lines.map((l) => ({
      receiverEmail: l.paypalEmail,
      amount: { value: toPayPalValue(l.amountMinor, promise.currency), currency: promise.currency },
      note: `Ahadi promise "${promise.title}", milestone ${milestone.position}: ${criteriaNote}.`,
      senderItemId: l.senderItemId,
    })),
  });

  const payoutBatchId = res.data.batch_header.payout_batch_id;
  await db.transaction(async (tx) => {
    await tx
      .update(payouts)
      .set({ paypalPayoutBatchId: payoutBatchId, raw: res.data as unknown as Record<string, unknown> })
      .where(eq(payouts.settlementId, settlementId));
    await appendLedgerEvent(tx, {
      promiseId: promise.id,
      type: "payout.sent",
      actor: "system",
      payload: {
        milestoneId: milestone.id,
        settlementId,
        payoutBatchId,
        senderBatchId: batchId,
        batchStatus: res.data.batch_header.batch_status,
        platformFeeMinor: plan.platformFeeMinor,
        distributableMinor: plan.distributableMinor,
        recipients: lines.map((l) => ({ to: maskEmail(l.paypalEmail), amountMinor: l.amountMinor })),
      },
    });
  });
  log.info(
    {
      promise_id: promise.id,
      milestone_id: milestone.id,
      payout_batch_id: payoutBatchId,
      amount: formatMoney(plan.distributableMinor),
    },
    "payout sent",
  );
  return { status: "sent" };
}

const ITEM_STATUS: Record<PayoutItemStatus, Payout["status"]> = {
  SUCCESS: "SUCCESS",
  UNCLAIMED: "UNCLAIMED",
  PENDING: "PENDING",
  ONHOLD: "PENDING",
  FAILED: "FAILED",
  BLOCKED: "FAILED",
  RETURNED: "RETURNED",
  REFUNDED: "RETURNED",
  REVERSED: "RETURNED",
};

export function mapPayoutItemStatus(s: string | undefined): Payout["status"] {
  return (s && ITEM_STATUS[s as PayoutItemStatus]) || "PENDING";
}

/** Apply one PayPal payout item status (from reconcile or a PAYMENT.PAYOUTS-ITEM.* webhook). */
export async function applyPayoutItemUpdate(args: {
  senderItemId: string;
  payoutItemId: string;
  transactionStatus: string | undefined;
  raw: unknown;
}) {
  const db = getDb();
  const status = mapPayoutItemStatus(args.transactionStatus);
  const [row] = await db.select().from(payouts).where(eq(payouts.senderItemId, args.senderItemId));
  if (!row) return null;
  if (row.status === status && row.paypalPayoutItemId === args.payoutItemId) return row;
  const ctx = await loadSettlementContext(db, row.settlementId);
  await db.transaction(async (tx) => {
    await tx
      .update(payouts)
      .set({ status, paypalPayoutItemId: args.payoutItemId, raw: args.raw as Record<string, unknown> })
      .where(eq(payouts.id, row.id));
    if (status !== "PENDING" && status !== row.status) {
      await appendLedgerEvent(tx, {
        promiseId: ctx.promise.id,
        type: status === "SUCCESS" ? "payout.succeeded" : `payout.${status.toLowerCase()}`,
        actor: "paypal",
        payload: {
          milestoneId: ctx.milestone.id,
          payoutItemId: args.payoutItemId,
          to: maskEmail(row.recipientPaypalEmail),
          amountMinor: row.amountMinor,
          status: args.transactionStatus ?? null,
        },
      });
    }
  });
  await maybeCompleteSettlement(row.settlementId);
  return { ...row, status };
}

/** SETTLED once every payout item succeeded (SPEC §6.7 "milestone SETTLED on success"). */
export async function maybeCompleteSettlement(settlementId: string) {
  const db = getDb();
  const rows = await db.select().from(payouts).where(eq(payouts.settlementId, settlementId));
  if (rows.length > 0 && rows.every((r) => r.status === "SUCCESS"))
    await completeSettlement(settlementId, "paid");
}

async function completeSettlement(settlementId: string, reason: "paid" | "nothing_to_pay") {
  const db = getDb();
  const ctx = await loadSettlementContext(db, settlementId);
  if (ctx.settlement?.status === "PAID") return;
  await db.transaction(async (tx) => {
    await tx.update(settlements).set({ status: "PAID" }).where(eq(settlements.id, settlementId));
    if (ctx.milestone.state === "SETTLING") {
      await applyMilestoneEvent(tx, {
        milestoneId: ctx.milestone.id,
        event: "SETTLEMENT_COMPLETED",
        actor: SYSTEM,
        payload: { settlementId, reason, capturedMinor: ctx.settlement?.capturedMinor ?? 0 },
      });
    }
  });
  await afterSettled(
    ctx.promise.id,
    ctx.milestone.id,
    ctx.promise.workerUserId,
    ctx.promise.clientUserId,
    ctx.settlement?.capturedMinor ?? 0,
    ctx.promise.currency,
    ctx.milestone.title,
    ctx.promise.workerAgentId,
  );
}

/** payout.reconcile (every 15 min, SPEC §17): poll batches that still have non-final items. */
export async function reconcilePayouts(
  onlySettlementId?: string,
): Promise<{ batches: number; updated: number }> {
  const db = getDb();
  const pending = await db
    .select()
    .from(payouts)
    .where(
      and(
        isNotNull(payouts.paypalPayoutBatchId),
        inArray(payouts.status, ["PENDING", "UNCLAIMED"]),
        onlySettlementId ? eq(payouts.settlementId, onlySettlementId) : undefined,
      ),
    );
  const batchIds = [...new Set(pending.map((p) => p.paypalPayoutBatchId!))];
  let updated = 0;
  for (const batchId of batchIds) {
    try {
      const { data } = await getPayoutBatch(getPayPal(), batchId);
      for (const item of data.items ?? []) {
        if (!item.payout_item.sender_item_id) continue;
        const before = pending.find((p) => p.senderItemId === item.payout_item.sender_item_id);
        const res = await applyPayoutItemUpdate({
          senderItemId: item.payout_item.sender_item_id,
          payoutItemId: item.payout_item_id,
          transactionStatus: item.transaction_status,
          raw: item,
        });
        if (res && before && res.status !== before.status) updated++;
      }
    } catch (e) {
      log.warn(
        { payout_batch_id: batchId, err: e instanceof PayPalError ? e.toJSON() : String(e) },
        "payout reconcile failed",
      );
    }
  }
  return { batches: batchIds.length, updated };
}

/** Settlement follow-ups (SPEC §17): passport, provider event, notifications, risk. */
export async function afterSettled(
  promiseId: string,
  milestoneId: string,
  workerUserId: string | null,
  clientUserId: string | null,
  capturedMinor: number,
  currency: string,
  title: string,
  workerAgentId: string | null,
) {
  if (workerUserId) await enqueue("passport.recompute", { userId: workerUserId });
  if (workerAgentId) await enqueue("provider.dispatch", { promiseId, milestoneId, event: "job.paid" });
  await enqueue("risk.score", { promiseId, trigger: "payout" });
  await notify({
    userId: workerUserId,
    template: "payment_sent",
    title: `You've been paid: ${title}`,
    body:
      capturedMinor > 0
        ? `${formatMoney(capturedMinor, currency)} was released after verification and sent to your PayPal. You can withdraw to M-Pesa from the M-Pesa app.`
        : "This milestone closed without a release.",
    link: `/promises/${promiseId}`,
    promiseId,
  });
  await notify({
    userId: clientUserId,
    template: "payment_sent",
    title: `Milestone settled: ${title}`,
    body:
      capturedMinor > 0
        ? `${formatMoney(capturedMinor, currency)} was captured for verified work; any remainder of the hold was released to you.`
        : "Nothing was captured; the PayPal hold was released.",
    link: `/promises/${promiseId}`,
    promiseId,
  });
}
