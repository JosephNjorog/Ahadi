import { and, eq, inArray, isNull } from "drizzle-orm";
import { AppError, fromPayPalValue } from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";
import { fundings, getDb, milestones, payouts, riskFlags, settlements, webhookEvents } from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import {
  verifyWebhookSignature,
  type Authorization,
  type Capture,
  type Dispute,
  type PayoutItem,
  type WebhookEvent,
  type WebhookSignatureHeaders,
} from "@ahadi/paypal";
import { enqueue } from "@ahadi/queue";
import { PAYPAL } from "./actor";
import { loadProposalContext } from "./context";
import { recordAuthorization } from "./funding";
import { log } from "./log";
import { applyPayoutItemUpdate, reconcilePayouts } from "./payouts";
import { getPayPal } from "./paypal";
import { recordCapture, recordVoid } from "./settlement-exec";

type Related = { supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string; capture_id?: string } } };

/**
 * POST /api/webhooks/paypal: verify the signature, store keyed by event id (duplicates ignored),
 * enqueue processing and return fast. PayPal webhooks are the source of truth (SPEC §0 principle 6).
 */
export async function ingestPayPalWebhook(rawBody: string, headers: WebhookSignatureHeaders): Promise<{ status: "queued" | "duplicate" }> {
  const env = getEnv();
  if (!env.PAYPAL_WEBHOOK_ID) throw new AppError("CONFIG_MISSING", "PAYPAL_WEBHOOK_ID is not set — run npm run paypal:webhook");
  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    throw new AppError("VALIDATION_FAILED", "Webhook body is not JSON");
  }
  if (!event.id || !event.event_type) throw new AppError("VALIDATION_FAILED", "Not a PayPal webhook event");

  const verified = await verifyWebhookSignature(getPayPal(), { headers, rawBody, webhookId: env.PAYPAL_WEBHOOK_ID });
  if (!verified) {
    log.warn({ event_id: event.id, event_type: event.event_type }, "rejected webhook with invalid signature");
    throw new AppError("FORBIDDEN", "Webhook signature verification failed");
  }

  const [inserted] = await getDb()
    .insert(webhookEvents)
    .values({
      id: event.id,
      eventType: event.event_type,
      resourceId: (event.resource as { id?: string })?.id ?? null,
      payload: event as unknown as Record<string, unknown>,
      verified: true,
    })
    .onConflictDoNothing({ target: webhookEvents.id })
    .returning();
  if (!inserted) return { status: "duplicate" };
  await enqueue("webhook.process", { eventId: event.id });
  return { status: "queued" };
}

/** webhook.process job. Handlers are idempotent; replaying an event is safe. */
export async function processWebhookEvent(eventId: string): Promise<string> {
  const db = getDb();
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
  if (!row) throw new AppError("NOT_FOUND", `Webhook event ${eventId} not stored`);
  if (row.processedAt) return "already_processed";
  const event = row.payload as unknown as WebhookEvent;
  let result: string;
  try {
    result = await dispatch(event);
    await db.update(webhookEvents).set({ processedAt: new Date(), error: null }).where(eq(webhookEvents.id, eventId));
  } catch (e) {
    await db.update(webhookEvents).set({ error: String((e as Error).message ?? e) }).where(eq(webhookEvents.id, eventId));
    throw e;
  }
  log.info({ event_id: eventId, event_type: event.event_type, result }, "webhook processed");
  return result;
}

async function dispatch(event: WebhookEvent): Promise<string> {
  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED":
      return onOrderApproved(event.resource as { id: string });
    case "PAYMENT.AUTHORIZATION.CREATED":
      return onAuthorizationCreated(event.resource as unknown as Authorization & Related);
    case "PAYMENT.AUTHORIZATION.VOIDED":
      return onAuthorizationVoided(event.resource as unknown as Authorization);
    case "PAYMENT.CAPTURE.COMPLETED":
    case "PAYMENT.CAPTURE.PENDING":
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
      return onCaptureEvent(event.resource as unknown as Capture & Related);
    case "PAYMENT.CAPTURE.REFUNDED":
      return onCaptureRefunded(event);
    case "PAYMENT.PAYOUTSBATCH.SUCCESS":
    case "PAYMENT.PAYOUTSBATCH.DENIED":
    case "PAYMENT.PAYOUTSBATCH.PROCESSING":
      return onPayoutBatch(event.resource as { batch_header?: { payout_batch_id?: string } });
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.RETURNED":
    case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
    case "PAYMENT.PAYOUTS-ITEM.CANCELED":
    case "PAYMENT.PAYOUTS-ITEM.DENIED":
    case "PAYMENT.PAYOUTS-ITEM.HELD":
    case "PAYMENT.PAYOUTS-ITEM.REFUNDED":
      return onPayoutItem(event.resource as unknown as PayoutItem);
    case "CUSTOMER.DISPUTE.CREATED":
    case "CUSTOMER.DISPUTE.UPDATED":
    case "CUSTOMER.DISPUTE.RESOLVED":
      return onDispute(event.event_type, event.resource as unknown as Dispute);
    default:
      return "ignored";
  }
}

async function onOrderApproved(order: { id: string }) {
  const res = await getDb()
    .update(fundings)
    .set({ status: "APPROVED" })
    .where(and(eq(fundings.paypalOrderId, order.id), eq(fundings.status, "CREATED")))
    .returning({ id: fundings.id });
  return res.length ? "funding_approved" : "no_change";
}

async function onAuthorizationCreated(auth: Authorization & Related) {
  const orderId = auth.supplementary_data?.related_ids?.order_id;
  if (!orderId) return "no_order_id";
  const [f] = await getDb().select().from(fundings).where(eq(fundings.paypalOrderId, orderId));
  if (!f) return "unknown_order";
  if (f.status === "AUTHORIZED" || f.status === "REAUTHORIZED") return "already_secured";
  if (f.status === "CANCELLED") return "funding_cancelled";
  await recordAuthorization({ milestoneId: f.milestoneId, orderId, authorization: auth, actor: PAYPAL, source: "webhook" });
  return "funds_secured";
}

async function onAuthorizationVoided(auth: Authorization) {
  const db = getDb();
  const [f] = await db.select().from(fundings).where(eq(fundings.paypalAuthorizationId, auth.id));
  if (!f) return "unknown_authorization";
  if (f.status === "VOIDED") return "already_voided";
  const [m] = await db.select().from(milestones).where(eq(milestones.id, f.milestoneId));
  if (m && (m.state === "REFUNDING" || m.state === "SETTLING")) {
    await recordVoid(null, f, m.id, m.promiseId, "paypal_webhook");
    return "milestone_voided";
  }
  await db.update(fundings).set({ status: "VOIDED" }).where(eq(fundings.id, f.id));
  return "funding_voided";
}

async function onCaptureEvent(capture: Capture & Related) {
  const db = getDb();
  let [s] = await db.select().from(settlements).where(eq(settlements.paypalCaptureId, capture.id));
  if (!s) {
    // The webhook can beat our own DB write; find the settlement through the authorization.
    const authId = capture.supplementary_data?.related_ids?.authorization_id;
    if (!authId) return "unknown_capture";
    const [f] = await db.select().from(fundings).where(eq(fundings.paypalAuthorizationId, authId));
    if (!f) return "unknown_authorization";
    const open = await db
      .select({ s: settlements })
      .from(settlements)
      .where(inArray(settlements.status, ["PENDING", "CAPTURE_PENDING"]));
    for (const { s: cand } of open) {
      const ctx = await loadProposalContext(db, cand.proposalId);
      if (ctx.milestone.id === f.milestoneId) {
        s = cand;
        break;
      }
    }
    if (!s) return "no_open_settlement";
  }
  if (s.status === "CAPTURED" || s.status === "PAID") return "already_captured";
  const ctx = await loadProposalContext(db, s.proposalId);
  const authId = capture.supplementary_data?.related_ids?.authorization_id;
  const candidates = await db.select().from(fundings).where(eq(fundings.milestoneId, ctx.milestone.id));
  const funding =
    candidates.find((x) => authId && x.paypalAuthorizationId === authId) ??
    candidates.filter((x) => x.paypalAuthorizationId).sort((a, b) => b.attempt - a.attempt)[0];
  if (!funding) return "no_funding";
  const isFull = fromPayPalValue(capture.amount.value) === funding.amountMinor;
  const outcome = await recordCapture(s.id, funding, capture, { isFull, milestoneId: ctx.milestone.id, promiseId: ctx.promise.id });
  return `capture_${outcome}`;
}

async function onCaptureRefunded(event: WebhookEvent) {
  const refund = event.resource as { id: string; amount?: { value: string }; links?: { href: string; rel: string }[] };
  const captureHref = refund.links?.find((l) => l.rel === "up")?.href;
  const captureId = captureHref?.split("/").pop();
  if (!captureId) return "no_capture_link";
  const db = getDb();
  const [s] = await db.select().from(settlements).where(eq(settlements.paypalCaptureId, captureId));
  if (!s) return "unknown_capture";
  const ctx = await loadProposalContext(db, s.proposalId);
  await db.transaction((tx) =>
    appendLedgerEvent(tx, {
      promiseId: ctx.promise.id,
      type: "capture.refunded",
      actor: "paypal",
      payload: { milestoneId: ctx.milestone.id, captureId, refundId: refund.id, amountMinor: refund.amount ? fromPayPalValue(refund.amount.value) : null },
    }),
  );
  return "refund_recorded";
}

async function onPayoutBatch(resource: { batch_header?: { payout_batch_id?: string } }) {
  const batchId = resource.batch_header?.payout_batch_id;
  if (!batchId) return "no_batch_id";
  const [p] = await getDb().select().from(payouts).where(eq(payouts.paypalPayoutBatchId, batchId)).limit(1);
  if (!p) return "unknown_batch";
  const r = await reconcilePayouts(p.settlementId);
  return `reconciled_${r.updated}`;
}

async function onPayoutItem(item: PayoutItem) {
  const senderItemId = item.payout_item?.sender_item_id;
  if (!senderItemId) return "no_sender_item_id";
  const res = await applyPayoutItemUpdate({
    senderItemId,
    payoutItemId: item.payout_item_id,
    transactionStatus: item.transaction_status,
    raw: item,
  });
  return res ? `payout_${res.status.toLowerCase()}` : "unknown_payout";
}

/** Phase 1: record and flag. Evidence-pack upload (SPEC §6.8) lands with the PDF in Phase 4. */
async function onDispute(type: string, dispute: Dispute) {
  const db = getDb();
  const captureIds = (dispute.disputed_transactions ?? []).map((t) => t.seller_transaction_id).filter(Boolean) as string[];
  if (captureIds.length === 0) return "no_transactions";
  const rows = await db.select().from(settlements).where(inArray(settlements.paypalCaptureId, captureIds));
  for (const s of rows) {
    const ctx = await loadProposalContext(db, s.proposalId);
    await db.transaction(async (tx) => {
      await appendLedgerEvent(tx, {
        promiseId: ctx.promise.id,
        type: `paypal.${type.toLowerCase().replace("customer.", "")}`,
        actor: "paypal",
        payload: { milestoneId: ctx.milestone.id, disputeId: dispute.dispute_id, status: dispute.status, reason: dispute.reason ?? null },
      });
      if (type === "CUSTOMER.DISPUTE.CREATED") {
        await tx.insert(riskFlags).values({
          subjectType: "promise",
          subjectId: ctx.promise.id,
          code: "PAYPAL_DISPUTE",
          severity: "high",
          detail: { disputeId: dispute.dispute_id, captureId: s.paypalCaptureId, reason: dispute.reason ?? null },
        });
      }
    });
  }
  return `dispute_recorded_${rows.length}`;
}

/** Webhook events that failed processing — for the admin view. */
export async function listUnprocessedWebhooks(limit = 50) {
  return getDb().select().from(webhookEvents).where(isNull(webhookEvents.processedAt)).limit(limit);
}
