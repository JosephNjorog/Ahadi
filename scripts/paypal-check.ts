/**
 * npm run paypal:check — verifies the environment end to end before a demo:
 *   PayPal credentials, Payouts permission, webhook registration, Neon/Postgres and Redis.
 */
import { config } from "dotenv";
config();

const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ! ${m}`);
const fail = (m: string) => console.log(`  ✗ ${m}`);
let failures = 0;

async function checkPayPal() {
  console.log("PayPal");
  const env = process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
  const base = env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    fail("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set");
    failures++;
    return;
  }
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json()) as {
    access_token?: string;
    scope?: string;
    app_id?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    fail(`OAuth failed (${res.status}): ${body.error_description ?? "check credentials and PAYPAL_ENV"}`);
    failures++;
    return;
  }
  ok(`OAuth token issued (${env}, app ${body.app_id ?? "?"})`);
  const scopes = (body.scope ?? "").split(" ");
  // PayPal has used more than one URI for some scopes; any listed alias counts.
  const need: [string, string][] = [
    ["https://uri.paypal.com/services/payments/payment/authcapture", "Authorize & capture"],
    ["https://uri.paypal.com/services/payments/payouts|https://uri.paypal.com/payments/payouts", "Payouts"],
    ["https://uri.paypal.com/services/payments/refund", "Refunds"],
    ["https://uri.paypal.com/services/disputes/read-seller", "Disputes (read)"],
  ];
  for (const [scope, label] of need) {
    if (scope.split("|").some((x) => scopes.includes(x))) ok(`${label} enabled`);
    else if (label === "Payouts") {
      fail(`${label} NOT enabled — Developer Dashboard → your app → Features → check "Payouts" → Save`);
      failures++;
    } else warn(`${label} scope not present (${scope})`);
  }
  if (process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID && process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID !== id) {
    fail("NEXT_PUBLIC_PAYPAL_CLIENT_ID differs from PAYPAL_CLIENT_ID — they must be the same app");
    failures++;
  }
  const hooks = await fetch(`${base}/v1/notifications/webhooks`, {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  const list = (await hooks.json()) as {
    webhooks?: { id: string; url: string; event_types: { name: string }[] }[];
  };
  const wid = process.env.PAYPAL_WEBHOOK_ID;
  const match = list.webhooks?.find((w) => w.id === wid);
  if (!wid) warn("PAYPAL_WEBHOOK_ID not set — run npm run paypal:webhook");
  else if (!match) {
    fail(`PAYPAL_WEBHOOK_ID ${wid} is not registered on this app`);
    failures++;
  } else ok(`Webhook ${wid} → ${match.url} (${match.event_types.length} events)`);
  for (const k of ["DEMO_BUYER_PAYPAL_EMAIL", "DEMO_WORKER_PAYPAL_EMAIL"]) {
    if (process.env[k]) ok(`${k} = ${process.env[k]}`);
    else warn(`${k} not set (sandbox personal account email)`);
  }
}

async function checkDb() {
  console.log("Database");
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail("DATABASE_URL not set");
    failures++;
    return;
  }
  const { createDb } = await import("@ahadi/db");
  const { sql } = await import("drizzle-orm");
  const { db, pool } = createDb(url, 1);
  try {
    const r = await db.execute<{ v: string }>(sql`select version() as v`);
    ok(`Connected to ${new URL(url).hostname} — ${String(r.rows[0]?.v).split(",")[0]}`);
    const t = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from information_schema.tables where table_schema = 'public'`,
    );
    const n = Number(t.rows[0]?.n ?? 0);
    if (n >= 20) ok(`${n} tables present`);
    else {
      fail(`Only ${n} tables — run npm run db:migrate`);
      failures++;
    }
  } catch (e) {
    fail(`Connection failed: ${(e as Error).message}`);
    failures++;
  } finally {
    await pool.end();
  }
}

async function checkRedis() {
  console.log("Redis");
  const { redisConnection } = await import("@ahadi/queue");
  const r = redisConnection();
  try {
    const pong = await Promise.race([
      r.ping(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    ok(`PING → ${String(pong)}`);
    const policy = (await r.config("GET", "maxmemory-policy").catch(() => null)) as string[] | null;
    if (policy && policy[1] !== "noeviction")
      warn(`maxmemory-policy is ${policy[1]} — BullMQ needs noeviction`);
  } catch (e) {
    fail(`Redis unreachable at ${process.env.REDIS_URL}: ${(e as Error).message}`);
    failures++;
  } finally {
    r.disconnect();
  }
}

await checkPayPal();
await checkDb();
await checkRedis();
console.log(failures ? `\n${failures} problem(s) found.` : "\nAll good.");
process.exit(failures ? 1 : 0);
