import { NextResponse } from "next/server";
import { recordDecision } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** SPEC §16: { decision: accept | object | resubmit, reason? } */
export const POST = withUser<{ id: string }>(async ({ req, actor, params }) =>
  NextResponse.json(await recordDecision(actor, params.id, await req.json().catch(() => ({})))),
);
