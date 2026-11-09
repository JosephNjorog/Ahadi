import { NextResponse } from "next/server";
import { decideMediation } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, actor, params }) =>
  NextResponse.json(await decideMediation(actor, params.id, await req.json().catch(() => ({})))),
);
