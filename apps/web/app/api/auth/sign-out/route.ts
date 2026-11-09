import { NextResponse } from "next/server";
import { withPublic } from "@/lib/api";
import { clearSession } from "@/lib/session";

export const runtime = "nodejs";

export const POST = withPublic(async () => {
  await clearSession();
  return NextResponse.json({ ok: true });
});
