import { sql } from "drizzle-orm";
import { getDb, ledgerAnchors } from "@ahadi/db";

/** Daily anchor of each promise's latest ledger hash (SPEC §11.2). Idempotent per (promise, seq). */
export async function anchorLedgers() {
  const db = getDb();
  const heads = await db.execute<{ promise_id: string; seq: number; hash: string }>(sql`
    select distinct on (promise_id) promise_id, seq, hash from ledger_events order by promise_id, seq desc`);
  let n = 0;
  for (const h of heads.rows) {
    const r = await db
      .insert(ledgerAnchors)
      .values({ promiseId: h.promise_id, seq: h.seq, headHash: h.hash })
      .onConflictDoNothing()
      .returning();
    n += r.length;
  }
  return { promises: heads.rows.length, anchored: n };
}
