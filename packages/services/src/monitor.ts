import { and, eq, inArray } from "drizzle-orm";
import { FUNDS_HELD_STATES, idempotencyKeys, toPayPalValue, type MilestoneState } from "@ahadi/core";
import { fundings, getDb, ledgerEvents, milestones } from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import { PayPalError, getAuthorization, reauthorize } from "@ahadi/paypal";
import { SYSTEM } from "./actor";
import { HONOR_PERIOD_MS, LIVE_FUNDING_STATUSES } from "./funding";
import { log } from "./log";
import { getPayPal } from "./paypal";
import { applyMilestoneEvent } from "./transitions";

const WARN_BEFORE_EXPIRY_MS = 48 * 3600 * 1000;

export interface MonitorReport {
  checked: number;
  reauthorized: number;
  reauthFailed: number;
  expiringWarned: number;
  expired: number;
  synced: number;
}

/**
 * authorization.monitor (hourly, SPEC §6.4). Keeps holds from lapsing silently:
 * sync status from PayPal, reauthorize after the honor period, warn 48h before expiry,
 * and mark expired holds (milestone → UNFUNDED).
 */
export async function monitorAuthorizations(now = new Date()): Promise<MonitorReport> {
  const db = getDb();
  const report: MonitorReport = { checked: 0, reauthorized: 0, reauthFailed: 0, expiringWarned: 0, expired: 0, synced: 0 };
  const rows = await db
    .select({ f: fundings, m: milestones })
    .from(fundings)
    .innerJoin(milestones, eq(milestones.id, fundings.milestoneId))
    .where(inArray(fundings.status, [...LIVE_FUNDING_STATUSES]));

  for (const { f, m } of rows) {
    if (!FUNDS_HELD_STATES.has(m.state as MilestoneState) || !f.paypalAuthorizationId) continue;
    report.checked++;
    const ctx = { promise_id: m.promiseId, milestone_id: m.id, authorization_id: f.paypalAuthorizationId };
    try {
      const { data: auth } = await getAuthorization(getPayPal(), f.paypalAuthorizationId);

      if (auth.status === "EXPIRED" || (f.expiresAt && f.expiresAt <= now)) {
        await db.transaction(async (tx) => {
          await tx.update(fundings).set({ status: "EXPIRED" }).where(eq(fundings.id, f.id));
          if (m.state === "FUNDED") {
            await applyMilestoneEvent(tx, { milestoneId: m.id, event: "AUTHORIZATION_EXPIRED", actor: SYSTEM, payload: { authorizationId: f.paypalAuthorizationId } });
          } else {
            await appendLedgerEvent(tx, { promiseId: m.promiseId, type: "funding.expired", actor: "system", payload: { milestoneId: m.id, milestoneState: m.state, authorizationId: f.paypalAuthorizationId } });
          }
        });
        report.expired++;
        log.warn(ctx, "authorization expired");
        continue;
      }
      if (auth.status === "VOIDED" || auth.status === "CAPTURED") {
        await db.update(fundings).set({ status: auth.status === "VOIDED" ? "VOIDED" : "CAPTURED" }).where(eq(fundings.id, f.id));
        report.synced++;
        continue;
      }

      const honorExpired = f.honorExpiresAt ? f.honorExpiresAt <= now : false;
      if (honorExpired && !f.reauthorizedAt && m.state !== "SETTLING") {
        try {
          const { data: re } = await reauthorize(
            getPayPal(),
            f.paypalAuthorizationId,
            { currency_code: f.currency, value: toPayPalValue(f.amountMinor, f.currency) },
            idempotencyKeys.reauthorize(f.paypalAuthorizationId),
          );
          await db.transaction(async (tx) => {
            await tx
              .update(fundings)
              .set({
                status: "REAUTHORIZED",
                paypalAuthorizationId: re.id,
                reauthorizedAt: now,
                honorExpiresAt: new Date(now.getTime() + HONOR_PERIOD_MS),
                expiresAt: re.expiration_time ? new Date(re.expiration_time) : f.expiresAt,
              })
              .where(eq(fundings.id, f.id));
            await appendLedgerEvent(tx, {
              promiseId: m.promiseId,
              type: "funding.reauthorized",
              actor: "system",
              payload: { milestoneId: m.id, previousAuthorizationId: f.paypalAuthorizationId, authorizationId: re.id, expiresAt: re.expiration_time ?? null },
            });
          });
          report.reauthorized++;
        } catch (e) {
          report.reauthFailed++;
          await warnOnce(m.promiseId, m.id, "funding.reauthorize_failed", {
            authorizationId: f.paypalAuthorizationId,
            message: "Your hold needs refreshing.",
            error: e instanceof PayPalError ? { name: e.paypalName, issue: e.issue, debugId: e.debugId } : String(e),
          });
          log.warn({ ...ctx, err: e instanceof PayPalError ? e.toJSON() : String(e) }, "reauthorize failed");
        }
      }

      if (f.expiresAt && f.expiresAt.getTime() - now.getTime() <= WARN_BEFORE_EXPIRY_MS) {
        if (await warnOnce(m.promiseId, m.id, "funding.expiring_soon", { authorizationId: f.paypalAuthorizationId, expiresAt: f.expiresAt.toISOString() })) {
          report.expiringWarned++;
        }
      }
    } catch (e) {
      log.error({ ...ctx, err: e instanceof PayPalError ? e.toJSON() : String(e) }, "authorization monitor check failed");
    }
  }
  return report;
}

/** Append a warning ledger event only once per authorization. */
async function warnOnce(promiseId: string, milestoneId: string, type: string, payload: Record<string, unknown>): Promise<boolean> {
  const db = getDb();
  const existing = await db
    .select({ payload: ledgerEvents.payload })
    .from(ledgerEvents)
    .where(and(eq(ledgerEvents.promiseId, promiseId), eq(ledgerEvents.type, type)));
  if (existing.some((e) => e.payload.authorizationId === payload.authorizationId)) return false;
  await db.transaction((tx) => appendLedgerEvent(tx, { promiseId, type, actor: "system", payload: { milestoneId, ...payload } }));
  return true;
}
