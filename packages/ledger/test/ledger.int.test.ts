import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, ledgerEvents, promises } from "@ahadi/db";
import { runMigrations } from "@ahadi/db/migrate";
import { appendLedgerEvent, verifyLedger } from "../src/append";

const url = process.env.DATABASE_URL!;
const { db, pool } = createDb(url);
let promiseId: string;

beforeAll(async () => {
  await runMigrations(url);
  const [p] = await db.insert(promises).values({ title: "Ledger test", category: "web" }).returning();
  promiseId = p!.id;
});
afterAll(() => pool.end());

describe("ledger (Postgres)", () => {
  it("appends concurrently without seq collisions and verifies", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        db.transaction((tx) => appendLedgerEvent(tx, { promiseId, type: "test.event", actor: "system", payload: { i, note: "ünïcode ✓" } })),
      ),
    );
    const v = await verifyLedger(db, promiseId);
    expect(v).toMatchObject({ valid: true, length: 12 });
  });

  it("detects a tampered row", async () => {
    await db.execute(sql`update ${ledgerEvents} set payload = '{"i":42}'::jsonb where promise_id = ${promiseId} and seq = 5`);
    const v = await verifyLedger(db, promiseId);
    expect(v).toMatchObject({ valid: false, brokenAt: 5 });
  });

  it("rolls the event back with the transaction", async () => {
    const before = (await db.select().from(ledgerEvents).where(sql`promise_id = ${promiseId}`)).length;
    await expect(
      db.transaction(async (tx) => {
        await appendLedgerEvent(tx, { promiseId, type: "doomed", actor: "system", payload: {} });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const after = (await db.select().from(ledgerEvents).where(sql`promise_id = ${promiseId}`)).length;
    expect(after).toBe(before);
  });
});
