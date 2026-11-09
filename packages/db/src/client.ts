import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A transaction handle has the same query API as Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

/**
 * Builds pg pool options from a Postgres URL. Works for Neon (pooled "-pooler" host or direct)
 * and for plain local Postgres. Neon URLs carry `sslmode=require` and often `channel_binding=require`;
 * node-postgres takes channel binding as a client option, so we lift it out of the URL.
 */
export function poolConfigFromUrl(rawUrl: string, max = 10): pg.PoolConfig {
  const url = new URL(rawUrl);
  const channelBinding = url.searchParams.get("channel_binding");
  url.searchParams.delete("channel_binding");
  const sslmode = url.searchParams.get("sslmode");
  const isNeon = url.hostname.endsWith(".neon.tech");
  const wantsSsl = isNeon || (sslmode !== null && sslmode !== "disable");
  // Let us control SSL explicitly instead of pg-connection-string's sslmode semantics.
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: wantsSsl ? { rejectUnauthorized: true } : undefined,
    enableChannelBinding: channelBinding === "require" || channelBinding === "prefer" ? true : undefined,
    max,
    // Neon scales compute to zero; keep idle clients short-lived so we don't hold dead sockets.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  } as pg.PoolConfig;
}

type Global = typeof globalThis & { __ahadiPool?: pg.Pool; __ahadiDb?: Db };
const g = globalThis as Global;

/** Process-wide pool (survives Next.js dev hot reloads). */
export function getDb(): Db {
  if (g.__ahadiDb) return g.__ahadiDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See docs/SETUP.md (Neon).");
  const pool = new pg.Pool(poolConfigFromUrl(url, Number(process.env.DB_POOL_MAX ?? 10)));
  pool.on("error", (err) => {
    // An idle client died (e.g. Neon suspended compute). The pool replaces it on next checkout.
    console.error(JSON.stringify({ level: "warn", msg: "pg pool idle client error", err: err.message }));
  });
  g.__ahadiPool = pool;
  g.__ahadiDb = drizzle(pool, { schema, casing: "snake_case" });
  return g.__ahadiDb;
}

export function createDb(url: string, max = 5): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool(poolConfigFromUrl(url, max));
  return { db: drizzle(pool, { schema, casing: "snake_case" }), pool };
}

export async function closeDb() {
  if (g.__ahadiPool) await g.__ahadiPool.end();
  g.__ahadiPool = undefined;
  g.__ahadiDb = undefined;
}
