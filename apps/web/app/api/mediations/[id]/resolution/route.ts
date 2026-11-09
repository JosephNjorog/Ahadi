import { NextResponse } from "next/server";
import { adminProposeResolution } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(
  async ({ req, actor, params }) => {
    await adminProposeResolution(actor, params.id, await req.json().catch(() => ({})));
    return NextResponse.json({ ok: true });
  },
  { admin: true },
);
