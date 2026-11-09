import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ingestWhatsApp, log } from "@ahadi/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** WhatsApp Cloud API webhook verification (SPEC §18). */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (
    sp.get("hub.mode") === "subscribe" &&
    process.env.WHATSAPP_VERIFY_TOKEN &&
    sp.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(sp.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Inbound messages. Signed by Meta with X-Hub-Signature-256 when WHATSAPP_APP_SECRET is set. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return new Response("Bad signature", { status: 401 });
  }
  try {
    const queued = await ingestWhatsApp(JSON.parse(raw));
    return NextResponse.json({ ok: true, queued });
  } catch (e) {
    log.error({ err: (e as Error).message }, "whatsapp ingest failed");
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
