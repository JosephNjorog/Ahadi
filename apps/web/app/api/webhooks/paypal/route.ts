import { NextResponse, type NextRequest } from "next/server";
import { isAppError } from "@ahadi/core";
import { signatureHeadersFrom } from "@ahadi/paypal";
import { ingestPayPalWebhook, log } from "@ahadi/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SPEC §6.7. Verify → store (dedupe by event id) → enqueue → 200 fast.
 * A non-2xx makes PayPal retry, so we only fail when we genuinely couldn't accept the event.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    const result = await ingestPayPalWebhook(raw, signatureHeadersFrom((n) => req.headers.get(n)));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    if (isAppError(e) && (e.code === "FORBIDDEN" || e.code === "VALIDATION_FAILED")) {
      return NextResponse.json(e.toJSON(), { status: 400 });
    }
    log.error({ err: e instanceof Error ? e.message : String(e) }, "webhook ingest failed");
    return NextResponse.json({ error: { code: "INTERNAL", message: "Could not accept event" } }, { status: 500 });
  }
}
