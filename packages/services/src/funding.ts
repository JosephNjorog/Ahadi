import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError, fromPayPalValue, idempotencyKeys, toPayPalValue } from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";
import { fundings, getDb, milestones, promises, type Funding, type Tx } from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import {
  PayPalError,
  authorizeOrder,
  createAuthorizeOrder,
  extractAuthorization,
  getOrder,
  type Authorization,
} from "@ahadi/paypal";
import { actorTag, assertParty, type Actor } from "./actor";
import { log } from "./log";
import { getPayPal } from "./paypal";
import { applyMilestoneEvent, lockMilestone } from "./transitions";

/** PayPal's honor period: capture is most reliable within 3 days of authorization (SPEC §6.4). */
export const HONOR_PERIOD_MS = 3 * 24 * 3600 * 1000;
/** Maximum validity of a PayPal authorization. */
export const VALIDITY_PERIOD_MS = 29 * 24 * 3600 * 1000;

export const LIVE_FUNDING_STATUSES = ["AUTHORIZED", "REAUTHORIZED"] as const;

export async function getLiveFunding(
  db: Tx | ReturnType<typeof getDb>,
  milestoneId: string,
): Promise<Funding | undefined> {
  const [f] = await db
    .select()
    .from(fundings)
    .where(and(eq(fundings.milestoneId, milestoneId), inArray(fundings.status, [...LIVE_FUNDING_STATUSES])))
    .orderBy(desc(fundings.attempt))
    .limit(1);
  return f;
}

/**
 * POST /api/milestones/:id/order — create a PayPal order (intent AUTHORIZE) for the milestone amount.
 * Only the client may fund; terms must be agreed; the milestone must be unfunded.
 */
export async function createMilestoneOrder(
  actor: Actor,
  milestoneId: string,
): Promise<{ orderId: string; fundingId: string }> {
  const db = getDb();
  const env = getEnv();

  // Phase 1: validate and reserve a funding attempt number under lock.
  const prep = await db.transaction(async (tx) => {
    const { milestone, promise } = await lockMilestone(tx, milestoneId);
    assertParty(actor, promise, "client");
    if (!["AGREED", "ACTIVE"].includes(promise.state)) {
      throw new AppError("CONFLICT", "Both parties must sign the terms before funding");
    }
    if (!["UNFUNDED", "FUNDING"].includes(milestone.state)) {
      throw new AppError("CONFLICT", `Milestone is already ${milestone.state.toLowerCase()}`);
    }
    const attempt = milestone.fundingAttempts + 1;
    await tx.update(milestones).set({ fundingAttempts: attempt }).where(eq(milestones.id, milestone.id));
    return { milestone, promise, attempt };
  });

  const { milestone, promise, attempt } = prep;
  const base = env.APP_URL.replace(/\/$/, "");
  const order = await createAuthorizeOrder(
    getPayPal(),
    {
      referenceId: `ms_${milestone.id}`,
      customId: `${promise.id}:${milestone.id}`,
      invoiceId: `ahadi-${milestone.id}-f${attempt}`,
      description: `Ahadi milestone: ${milestone.title}`,
      amount: {
        currency_code: promise.currency,
        value: toPayPalValue(milestone.amountMinor, promise.currency),
      },
      returnUrl: `${base}/promises/${promise.id}/fund?milestone=${milestone.id}&paypal=return`,
      cancelUrl: `${base}/promises/${promise.id}/fund?milestone=${milestone.id}&paypal=cancel`,
    },
    idempotencyKeys.createOrder(milestone.id, attempt),
  );

  // Phase 2: record the order and move UNFUNDED → FUNDING (or FUNDING → FUNDING on a retry).
  const fundingId = await db.transaction(async (tx) => {
    await tx
      .update(fundings)
      .set({ status: "CANCELLED" })
      .where(and(eq(fundings.milestoneId, milestone.id), inArray(fundings.status, ["CREATED", "APPROVED"])));
    const [f] = await tx
      .insert(fundings)
      .values({
        milestoneId: milestone.id,
        attempt,
        paypalOrderId: order.data.id,
        amountMinor: milestone.amountMinor,
        currency: promise.currency,
        status: "CREATED",
        raw: order.data as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: fundings.paypalOrderId })
      .returning();
    const funding =
      f ?? (await tx.select().from(fundings).where(eq(fundings.paypalOrderId, order.data.id)))[0]!;
    await applyMilestoneEvent(tx, {
      milestoneId: milestone.id,
      event: "ORDER_CREATED",
      actor,
      payload: {
        orderId: order.data.id,
        amountMinor: milestone.amountMinor,
        currency: promise.currency,
        attempt,
      },
    });
    return funding.id;
  });

  log.info(
    { promise_id: promise.id, milestone_id: milestone.id, order_id: order.data.id, attempt },
    "funding order created",
  );
  return { orderId: order.data.id, fundingId };
}

/**
 * POST /api/milestones/:id/authorize — after the buyer approves in the PayPal popup.
 * Idempotent: authorizing an already-authorized order returns the existing funding.
 */
export async function authorizeMilestoneOrder(
  actor: Actor,
  milestoneId: string,
  orderId: string,
): Promise<Funding> {
  const db = getDb();
  const [funding] = await db.select().from(fundings).where(eq(fundings.paypalOrderId, orderId));
  if (!funding || funding.milestoneId !== milestoneId)
    throw new AppError("NOT_FOUND", "Order not found for this milestone");
  const [promise] = await db
    .select()
    .from(promises)
    .innerJoin(milestones, eq(milestones.promiseId, promises.id))
    .where(eq(milestones.id, milestoneId));
  assertParty(actor, promise!.promises, "client");
  if (funding.status === "AUTHORIZED" || funding.status === "REAUTHORIZED") return funding;
  if (funding.status === "CANCELLED")
    throw new AppError("CONFLICT", "This checkout was replaced by a newer one. Please try again.");

  let authorization: Authorization | undefined;
  let rawOrder: unknown;
  try {
    const res = await authorizeOrder(getPayPal(), orderId, idempotencyKeys.authorizeOrder(orderId));
    rawOrder = res.data;
    authorization = extractAuthorization(res.data);
  } catch (e) {
    // ORDER_ALREADY_AUTHORIZED: a previous attempt succeeded at PayPal but we didn't record it.
    if (e instanceof PayPalError && e.hasIssue("ORDER_ALREADY_AUTHORIZED")) {
      const res = await getOrder(getPayPal(), orderId);
      rawOrder = res.data;
      authorization = extractAuthorization(res.data);
    } else {
      throw e;
    }
  }
  if (!authorization)
    throw new AppError("PAYPAL_ERROR", "PayPal did not return an authorization for this order");

  return recordAuthorization({ milestoneId, orderId, authorization, rawOrder, actor, source: "api" });
}

/**
 * Shared by the API path and the PAYMENT.AUTHORIZATION.CREATED webhook (whichever lands first).
 * "Funds secured" requires an authorization with status CREATED (SPEC §6.3).
 */
export async function recordAuthorization(args: {
  milestoneId: string;
  orderId: string;
  authorization: Authorization;
  rawOrder?: unknown;
  actor: Actor;
  source: "api" | "webhook";
}): Promise<Funding> {
  const { authorization, orderId, milestoneId, actor } = args;
  const db = getDb();
  return db.transaction(async (tx) => {
    const { milestone, promise } = await lockMilestone(tx, milestoneId);
    const [funding] = await tx
      .select()
      .from(fundings)
      .where(eq(fundings.paypalOrderId, orderId))
      .for("update");
    if (!funding) throw new AppError("NOT_FOUND", "Funding not found");
    if (funding.status === "AUTHORIZED" || funding.status === "REAUTHORIZED") return funding;

    const amountMinor = fromPayPalValue(authorization.amount.value, authorization.amount.currency_code);
    if (amountMinor !== milestone.amountMinor || authorization.amount.currency_code !== promise.currency) {
      throw new AppError("PAYPAL_ERROR", "Authorized amount does not match the milestone", {
        authorized: authorization.amount,
        expectedMinor: milestone.amountMinor,
      });
    }

    const created = authorization.create_time ? new Date(authorization.create_time) : new Date();
    const expiresAt = authorization.expiration_time
      ? new Date(authorization.expiration_time)
      : new Date(created.getTime() + VALIDITY_PERIOD_MS);

    if (authorization.status === "PENDING") {
      // e.g. eCheck or review: not secured yet; the webhook will move it forward.
      const [f] = await tx
        .update(fundings)
        .set({
          status: "APPROVED",
          paypalAuthorizationId: authorization.id,
          raw: { order: args.rawOrder, authorization },
        })
        .where(eq(fundings.id, funding.id))
        .returning();
      await appendLedgerEvent(tx, {
        promiseId: promise.id,
        type: "funding.pending",
        actor: actorTag(actor),
        payload: {
          milestoneId,
          authorizationId: authorization.id,
          reason: authorization.status_details?.reason ?? null,
        },
      });
      return f!;
    }
    if (authorization.status !== "CREATED") {
      throw new AppError("PAYPAL_ERROR", `Authorization is ${authorization.status}, not CREATED`);
    }

    const [updated] = await tx
      .update(fundings)
      .set({
        status: "AUTHORIZED",
        paypalAuthorizationId: authorization.id,
        honorExpiresAt: new Date(created.getTime() + HONOR_PERIOD_MS),
        expiresAt,
        raw: { order: args.rawOrder ?? null, authorization },
        payerEmail:
          (args.rawOrder as { payer?: { email_address?: string } } | undefined)?.payer?.email_address ??
          funding.payerEmail,
        payerId:
          (args.rawOrder as { payer?: { payer_id?: string } } | undefined)?.payer?.payer_id ??
          funding.payerId,
      })
      .where(eq(fundings.id, funding.id))
      .returning();

    if (milestone.state === "FUNDING") {
      await applyMilestoneEvent(tx, {
        milestoneId,
        event: "AUTHORIZATION_CREATED",
        actor,
        payload: {
          authorizationId: authorization.id,
          amountMinor,
          currency: promise.currency,
          expiresAt: expiresAt.toISOString(),
          honorExpiresAt: updated!.honorExpiresAt?.toISOString(),
          confirmedBy: args.source,
        },
      });
    }
    log.info(
      {
        promise_id: promise.id,
        milestone_id: milestoneId,
        authorization_id: authorization.id,
        source: args.source,
      },
      "funds secured",
    );
    return updated!;
  });
}

/** Buyer closed the popup or PayPal redirected to cancel_url. */
export async function cancelMilestoneFunding(
  actor: Actor,
  milestoneId: string,
  orderId: string,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const { milestone, promise } = await lockMilestone(tx, milestoneId);
    assertParty(actor, promise, "client");
    const [f] = await tx.select().from(fundings).where(eq(fundings.paypalOrderId, orderId));
    if (!f || f.milestoneId !== milestoneId || !["CREATED", "APPROVED"].includes(f.status)) return;
    await tx.update(fundings).set({ status: "CANCELLED" }).where(eq(fundings.id, f.id));
    if (milestone.state === "FUNDING") {
      await applyMilestoneEvent(tx, { milestoneId, event: "FUNDING_CANCELLED", actor, payload: { orderId } });
    }
  });
}
