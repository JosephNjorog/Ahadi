import { NextResponse } from "next/server";
import { z } from "zod";
import { getMediationView, recordDecision } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ actor, params }) =>
  NextResponse.json(await getMediationView(actor, params.id)),
);

/** SPEC §16: open mediation with a statement (same as objecting to the proposal). */
export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { statement } = await readJson(req, z.object({ statement: z.string().trim().min(10).max(4000) }));
  return NextResponse.json(await recordDecision(actor, params.id, { decision: "object", reason: statement }));
});
