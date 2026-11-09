import { NextResponse } from "next/server";
import { setMandate } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** SPEC §16 PUT /api/agents/:id/mandate */
export const PUT = withUser<{ id: string }>(async ({ req, actor, params }) =>
  NextResponse.json({ mandate: await setMandate(actor, params.id, await req.json().catch(() => ({}))) }),
);
