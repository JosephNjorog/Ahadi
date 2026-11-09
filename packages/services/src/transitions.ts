import { eq, sql } from "drizzle-orm";
import {
  AppError,
  MILESTONE_EVENT_LEDGER_TYPE,
  TERMINAL_MILESTONE_STATES,
  nextPromiseState,
  transitionMilestone,
  type MilestoneEvent,
  type MilestoneState,
  type PromiseEvent,
  type PromiseState,
} from "@ahadi/core";
import { milestones, promises, type Milestone, type PromiseRow, type Tx } from "@ahadi/db";
import { appendLedgerEvent } from "@ahadi/ledger";
import { actorTag, type Actor } from "./actor";

/** Lock and load a milestone + its promise inside a transaction. */
export async function lockMilestone(
  tx: Tx,
  milestoneId: string,
): Promise<{ milestone: Milestone; promise: PromiseRow }> {
  const res = await tx.execute(
    sql`select id from ${milestones} where ${milestones.id} = ${milestoneId} for update`,
  );
  if (res.rows.length === 0) throw new AppError("NOT_FOUND", "Milestone not found");
  const [milestone] = await tx.select().from(milestones).where(eq(milestones.id, milestoneId));
  const [promise] = await tx.select().from(promises).where(eq(promises.id, milestone!.promiseId));
  return { milestone: milestone!, promise: promise! };
}

/**
 * The only path that changes milestone state (SPEC §4.3 rules): validates via the state machine,
 * updates the row and appends the ledger event in the same transaction, then derives promise state.
 */
export async function applyMilestoneEvent(
  tx: Tx,
  args: {
    milestoneId: string;
    event: MilestoneEvent;
    actor: Actor;
    payload?: Record<string, unknown>;
    ledgerType?: string;
    patch?: Partial<Pick<Milestone, "attemptsUsed" | "fundingAttempts">>;
  },
): Promise<{ from: MilestoneState; to: MilestoneState; milestone: Milestone; promise: PromiseRow }> {
  const { milestone, promise } = await lockMilestone(tx, args.milestoneId);
  const from = milestone.state as MilestoneState;
  const to = transitionMilestone(from, args.event);
  const [updated] = await tx
    .update(milestones)
    .set({ state: to, ...(args.patch ?? {}) })
    .where(eq(milestones.id, milestone.id))
    .returning();
  await appendLedgerEvent(tx, {
    promiseId: promise.id,
    type: args.ledgerType ?? MILESTONE_EVENT_LEDGER_TYPE[args.event],
    actor: actorTag(args.actor),
    payload: {
      milestoneId: milestone.id,
      position: milestone.position,
      from,
      to,
      event: args.event,
      ...(args.payload ?? {}),
    },
  });
  const updatedPromise = await derivePromiseState(tx, promise.id, args.actor);
  return { from, to, milestone: updated!, promise: updatedPromise };
}

export async function applyPromiseEvent(
  tx: Tx,
  args: {
    promiseId: string;
    event: PromiseEvent;
    actor: Actor;
    payload?: Record<string, unknown>;
    ledgerType?: string;
  },
): Promise<PromiseRow> {
  const [p] = await tx.select().from(promises).where(eq(promises.id, args.promiseId)).for("update");
  if (!p) throw new AppError("NOT_FOUND", "Promise not found");
  const to = nextPromiseState(p.state as PromiseState, args.event);
  if (!to)
    throw new AppError("ILLEGAL_TRANSITION", `promise: cannot apply ${args.event} in state ${p.state}`);
  const [updated] = await tx.update(promises).set({ state: to }).where(eq(promises.id, p.id)).returning();
  await appendLedgerEvent(tx, {
    promiseId: p.id,
    type: args.ledgerType ?? `promise.${args.event.toLowerCase()}`,
    actor: actorTag(args.actor),
    payload: { from: p.state, to, ...(args.payload ?? {}) },
  });
  return updated!;
}

/** Promise state derived from milestones (SPEC §4.2): AGREED→ACTIVE on first funding, ACTIVE→COMPLETED when all terminal. */
async function derivePromiseState(tx: Tx, promiseId: string, actor: Actor): Promise<PromiseRow> {
  const [p] = await tx.select().from(promises).where(eq(promises.id, promiseId));
  const ms = await tx
    .select({ state: milestones.state })
    .from(milestones)
    .where(eq(milestones.promiseId, promiseId));
  const state = p!.state as PromiseState;
  const anyFunded = ms.some((m) => !["UNFUNDED", "FUNDING"].includes(m.state));
  const allTerminal =
    ms.length > 0 && ms.every((m) => TERMINAL_MILESTONE_STATES.has(m.state as MilestoneState));
  if (state === "AGREED" && anyFunded) {
    const next = await applyPromiseEvent(tx, {
      promiseId,
      event: "FIRST_MILESTONE_FUNDED",
      actor,
      ledgerType: "promise.activated",
    });
    if (allTerminal)
      return applyPromiseEvent(tx, {
        promiseId,
        event: "ALL_MILESTONES_TERMINAL",
        actor,
        ledgerType: "promise.completed",
      });
    return next;
  }
  if (state === "ACTIVE" && allTerminal) {
    return applyPromiseEvent(tx, {
      promiseId,
      event: "ALL_MILESTONES_TERMINAL",
      actor,
      ledgerType: "promise.completed",
    });
  }
  return p!;
}
