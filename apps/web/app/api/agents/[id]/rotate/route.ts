import { NextResponse } from "next/server";
import { rotateAgentKey } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ actor, params }) =>
  NextResponse.json(await rotateAgentKey(actor, params.id)),
);
