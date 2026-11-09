import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ledgerEvents, promises, type DbOrTx, type LedgerEvent } from "@ahadi/db";
import { AppError } from "@ahadi/core";
import { computeEventHash, genesisHash, verifyChain, type ChainEvent } from "./chain";

export type Actor = `user:${string}` | `agent:${string}` | "system" | "paypal" | "admin";

export interface AppendInput {
  promiseId: string;
  type: string;
  actor: Actor | string;
  payload: Record<string, unknown>;
}

/**
 * Append an event. MUST be called inside the same transaction as the state change it records.
 * `SELECT … FOR UPDATE` on the promise row serialises concurrent appends for the same promise.
 */
export async function appendLedgerEvent(tx: DbOrTx, input: AppendInput): Promise<LedgerEvent> {
  const locked = await tx.execute(
    sql`select id from ${promises} where ${promises.id} = ${input.promiseId} for update`,
  );
  if (locked.rows.length === 0) throw new AppError("NOT_FOUND", `Promise ${input.promiseId} not found`);

  const [last] = await tx
    .select({ seq: ledgerEvents.seq, hash: ledgerEvents.hash })
    .from(ledgerEvents)
    .where(eq(ledgerEvents.promiseId, input.promiseId))
    .orderBy(desc(ledgerEvents.seq))
    .limit(1);

  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? genesisHash(input.promiseId);
  // Millisecond precision so the timestamp round-trips through Postgres exactly.
  const createdAt = new Date(Math.floor(Date.now()));
  // Round-trip payload through JSON so what we hash is exactly what jsonb stores.
  const payload = JSON.parse(JSON.stringify(input.payload)) as Record<string, unknown>;
  const hash = computeEventHash({ prevHash, seq, type: input.type, payload, createdAt });

  const [row] = await tx
    .insert(ledgerEvents)
    .values({
      promiseId: input.promiseId,
      seq,
      type: input.type,
      actor: input.actor,
      payload,
      prevHash,
      hash,
      createdAt,
    })
    .returning();
  return row!;
}

export async function getLedger(db: DbOrTx, promiseId: string): Promise<LedgerEvent[]> {
  return db
    .select()
    .from(ledgerEvents)
    .where(eq(ledgerEvents.promiseId, promiseId))
    .orderBy(asc(ledgerEvents.seq));
}

export async function verifyLedger(db: DbOrTx, promiseId: string) {
  const events = await getLedger(db, promiseId);
  return verifyChain(promiseId, events as ChainEvent[]);
}

export async function latestLedgerHash(db: DbOrTx, promiseId: string): Promise<string | null> {
  const [last] = await db
    .select({ hash: ledgerEvents.hash })
    .from(ledgerEvents)
    .where(and(eq(ledgerEvents.promiseId, promiseId)))
    .orderBy(desc(ledgerEvents.seq))
    .limit(1);
  return last?.hash ?? null;
}

/** Masks an email for ledger payloads: "worker@example.com" → "w****r@example.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  if (local.length <= 2) return `${local[0]}*@${domain}`;
  return `${local[0]}${"*".repeat(Math.min(4, local.length - 2))}${local[local.length - 1]}@${domain}`;
}
