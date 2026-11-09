import { NextResponse } from "next/server";
import { retryPayout } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(
  async ({ actor, params }) => {
    await retryPayout(actor, params.id);
    return NextResponse.json({ ok: true });
  },
  { admin: true },
);
