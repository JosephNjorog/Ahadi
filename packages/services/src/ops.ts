import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { opsSystem, PROMPTS, runToolLoop, type LoopTool } from "@ahadi/agents";
import { fundings, getDb, milestones, payouts, promises, settlements } from "@ahadi/db";
import { getAuthorization, getCapture, getOrder, getPayoutBatch } from "@ahadi/paypal";
import type Anthropic from "@anthropic-ai/sdk";
import { assertAdmin, type Actor } from "./actor";
import { getPayPal } from "./paypal";

/**
 * Ops Agent (SPEC §6.9, AGENT_PROMPTS §11). Read-only tools over Ahadi's data and PayPal GET
 * endpoints. It has no capture/void/refund/payout tools, so it cannot move money.
 */

const VIEWS = `
- list_fundings {status?, from?, to?}: PayPal orders/authorizations with milestone states and expiry
- list_settlements {from?, to?}: captures with amounts and PayPal fees
- list_payouts {status?}: payout items with status
- money_totals {from?, to?}: authorized, captured, voided, paid out and fees
- expiring_holds {hours}: authorizations expiring within N hours
- paypal_get_authorization {authorizationId} / paypal_get_capture {captureId} / paypal_get_order {orderId} / paypal_get_payout_batch {payoutBatchId}`;

const range = (i: Record<string, unknown>) => ({
  from: i.from ? new Date(String(i.from)) : new Date(Date.now() - 30 * 86400_000),
  to: i.to ? new Date(String(i.to)) : new Date(),
});

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});
const str = { type: "string" };

function tools(): LoopTool[] {
  const db = getDb();
  return [
    {
      name: "list_fundings",
      description:
        "List fundings (PayPal orders and authorizations) with milestone state, amount and expiry. Dates are ISO strings; times are UTC.",
      inputSchema: obj(
        {
          status: {
            type: "string",
            enum: [
              "CREATED",
              "APPROVED",
              "AUTHORIZED",
              "REAUTHORIZED",
              "PARTIALLY_CAPTURED",
              "CAPTURED",
              "VOIDED",
              "EXPIRED",
              "CANCELLED",
              "any",
            ],
          },
          from: str,
          to: str,
        },
        ["status", "from", "to"],
      ),
      run: async (i) => {
        const { from, to } = range(i);
        return db
          .select({
            fundingId: fundings.id,
            orderId: fundings.paypalOrderId,
            authorizationId: fundings.paypalAuthorizationId,
            status: fundings.status,
            amountMinor: fundings.amountMinor,
            expiresAt: fundings.expiresAt,
            milestoneId: milestones.id,
            milestoneState: milestones.state,
            promise: promises.title,
          })
          .from(fundings)
          .innerJoin(milestones, eq(milestones.id, fundings.milestoneId))
          .innerJoin(promises, eq(promises.id, milestones.promiseId))
          .where(
            and(
              i.status && i.status !== "any" ? eq(fundings.status, i.status as "AUTHORIZED") : undefined,
              gte(fundings.createdAt, from),
              lte(fundings.createdAt, to),
            ),
          )
          .orderBy(desc(fundings.createdAt))
          .limit(200);
      },
    },
    {
      name: "list_settlements",
      description: "List settlements (captures) with captured amount, PayPal fee and net, in a date range.",
      inputSchema: obj({ from: str, to: str }, ["from", "to"]),
      run: async (i) => {
        const { from, to } = range(i);
        return db
          .select()
          .from(settlements)
          .where(and(gte(settlements.createdAt, from), lte(settlements.createdAt, to)))
          .orderBy(desc(settlements.createdAt))
          .limit(200);
      },
    },
    {
      name: "list_payouts",
      description: "List payout items and their status.",
      inputSchema: obj(
        {
          status: { type: "string", enum: ["PENDING", "SUCCESS", "UNCLAIMED", "FAILED", "RETURNED", "any"] },
        },
        ["status"],
      ),
      run: async (i) =>
        db
          .select({
            id: payouts.id,
            status: payouts.status,
            amountMinor: payouts.amountMinor,
            recipient: payouts.recipientPaypalEmail,
            batchId: payouts.paypalPayoutBatchId,
            itemId: payouts.paypalPayoutItemId,
            settlementId: payouts.settlementId,
            updatedAt: payouts.updatedAt,
          })
          .from(payouts)
          .where(i.status && i.status !== "any" ? eq(payouts.status, i.status as "PENDING") : undefined)
          .orderBy(desc(payouts.updatedAt))
          .limit(200),
    },
    {
      name: "money_totals",
      description:
        "Totals in minor units (cents) for a date range: authorized, captured, voided, paid out, PayPal fees.",
      inputSchema: obj({ from: str, to: str }, ["from", "to"]),
      run: async (i) => {
        const { from, to } = range(i);
        const r = await db.execute(sql`
          select
            (select coalesce(sum(amount_minor),0) from fundings where status in ('AUTHORIZED','REAUTHORIZED','PARTIALLY_CAPTURED','CAPTURED','VOIDED','EXPIRED') and created_at between ${from} and ${to}) as authorized,
            (select coalesce(sum(captured_minor),0) from settlements where status in ('CAPTURED','PAID') and created_at between ${from} and ${to}) as captured,
            (select coalesce(sum(amount_minor),0) from fundings where status = 'VOIDED' and updated_at between ${from} and ${to}) as voided,
            (select coalesce(sum(amount_minor),0) from payouts where status = 'SUCCESS' and updated_at between ${from} and ${to}) as paid_out,
            (select coalesce(sum(paypal_fee_minor),0) from settlements where created_at between ${from} and ${to}) as paypal_fees`);
        return { range: { from, to }, ...r.rows[0] };
      },
    },
    {
      name: "expiring_holds",
      description: "Authorizations that expire within the given number of hours, with milestone states.",
      inputSchema: obj({ hours: { type: "integer" } }, ["hours"]),
      run: async (i) =>
        db
          .select({
            authorizationId: fundings.paypalAuthorizationId,
            expiresAt: fundings.expiresAt,
            honorExpiresAt: fundings.honorExpiresAt,
            amountMinor: fundings.amountMinor,
            milestoneId: milestones.id,
            state: milestones.state,
            promise: promises.title,
          })
          .from(fundings)
          .innerJoin(milestones, eq(milestones.id, fundings.milestoneId))
          .innerJoin(promises, eq(promises.id, milestones.promiseId))
          .where(
            and(
              inArray(fundings.status, ["AUTHORIZED", "REAUTHORIZED"]),
              lte(fundings.expiresAt, new Date(Date.now() + Number(i.hours ?? 48) * 3600_000)),
            ),
          ),
    },
    {
      name: "paypal_get_authorization",
      description: "Read one PayPal authorization.",
      inputSchema: obj({ authorizationId: str }, ["authorizationId"]),
      run: async (i) => (await getAuthorization(getPayPal(), String(i.authorizationId))).data,
    },
    {
      name: "paypal_get_capture",
      description: "Read one PayPal capture.",
      inputSchema: obj({ captureId: str }, ["captureId"]),
      run: async (i) => (await getCapture(getPayPal(), String(i.captureId))).data,
    },
    {
      name: "paypal_get_order",
      description: "Read one PayPal order.",
      inputSchema: obj({ orderId: str }, ["orderId"]),
      run: async (i) => (await getOrder(getPayPal(), String(i.orderId))).data,
    },
    {
      name: "paypal_get_payout_batch",
      description: "Read one PayPal payout batch with item statuses.",
      inputSchema: obj({ payoutBatchId: str }, ["payoutBatchId"]),
      run: async (i) => (await getPayoutBatch(getPayPal(), String(i.payoutBatchId))).data,
    },
  ];
}

export async function askOpsAgent(actor: Actor, history: { role: "user" | "assistant"; content: string }[]) {
  assertAdmin(actor);
  const messages: Anthropic.Beta.BetaMessageParam[] = history
    .slice(-12)
    .map((h) => ({ role: h.role, content: h.content }));
  const res = await runToolLoop({ meta: PROMPTS.ops, system: opsSystem(VIEWS), messages, tools: tools() });
  return { text: res.text, toolCalls: res.toolCalls };
}
