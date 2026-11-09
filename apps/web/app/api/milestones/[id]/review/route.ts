import { NextResponse } from "next/server";
import { reviewVerification } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** NEEDS_HUMAN → VERDICT_READY: client decides human criteria; an admin decides any blocked criterion. */
export const POST = withUser<{ id: string }>(async ({ req, actor, params }) =>
  NextResponse.json(await reviewVerification(actor, params.id, await req.json().catch(() => ({})))),
);
