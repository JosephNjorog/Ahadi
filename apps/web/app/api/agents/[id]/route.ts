import { NextResponse } from "next/server";
import { getAgentDetail, revokeAgent, updateAgent } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ actor, params }) =>
  NextResponse.json(await getAgentDetail(actor, params.id)),
);
export const PATCH = withUser<{ id: string }>(async ({ req, actor, params }) =>
  NextResponse.json(await updateAgent(actor, params.id, await req.json().catch(() => ({})))),
);
export const DELETE = withUser<{ id: string }>(async ({ actor, params }) => {
  await revokeAgent(actor, params.id);
  return NextResponse.json({ ok: true });
});
