import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getEnv, paypalConfigured } from "@ahadi/core/env";
import { getDb } from "@ahadi/db";
import { getQueue } from "@ahadi/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render health check: DB and Redis must answer; PayPal config is reported, not required. */
export async function GET() {
  const checks: Record<string, "ok" | "error" | "not_configured"> = {};
  try {
    await getDb().execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }
  try {
    const client = (await getQueue().client) as unknown as { ping(): Promise<string> };
    await client.ping();
    checks.queue = "ok";
  } catch {
    checks.queue = "error";
  }
  const env = getEnv();
  checks.paypal = paypalConfigured(env) ? "ok" : "not_configured";
  checks.paypalWebhook = env.PAYPAL_WEBHOOK_ID ? "ok" : "not_configured";
  const healthy = checks.database === "ok" && checks.queue === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", paypalEnv: env.PAYPAL_ENV, checks },
    { status: healthy ? 200 : 503 },
  );
}
