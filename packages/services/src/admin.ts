import { eq } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import { getDb, jobFailures, settlements } from "@ahadi/db";
import { enqueue } from "@ahadi/queue";
import { assertAdmin, type Actor } from "./actor";
import { loadSettlementContext } from "./context";
import { maybeCompleteSettlement } from "./payouts";

/** Retry a failed settlement (SETTLEMENT_FAILED → SETTLING happens inside the job). */
export async function retrySettlement(actor: Actor, settlementId: string) {
  assertAdmin(actor);
  const ctx = await loadSettlementContext(getDb(), settlementId);
  if (ctx.settlement?.status !== "FAILED")
    throw new AppError("CONFLICT", "Only failed settlements can be retried");
  await enqueue(
    "settlement.execute",
    { proposalId: ctx.proposal.id },
    { jobId: `settle-${ctx.proposal.id}-retry-${Date.now()}` },
  );
}

/** Re-send or re-check a payout. */
export async function retryPayout(actor: Actor, settlementId: string) {
  assertAdmin(actor);
  const [s] = await getDb().select().from(settlements).where(eq(settlements.id, settlementId));
  if (!s) throw new AppError("NOT_FOUND", "Settlement not found");
  if (s.status === "CAPTURED") {
    await enqueue("payout.send", { settlementId }, { jobId: `payout-${settlementId}-retry-${Date.now()}` });
    await enqueue("payout.reconcile", { settlementId });
  }
  await maybeCompleteSettlement(settlementId);
}

export async function recordJobFailure(args: {
  queue: string;
  jobName: string;
  jobId?: string;
  data: unknown;
  error: string;
  attempts: number;
}) {
  await getDb()
    .insert(jobFailures)
    .values({ ...args, data: args.data as Record<string, unknown> });
}

export async function resolveJobFailure(actor: Actor, id: string) {
  assertAdmin(actor);
  await getDb().update(jobFailures).set({ resolvedAt: new Date() }).where(eq(jobFailures.id, id));
}
