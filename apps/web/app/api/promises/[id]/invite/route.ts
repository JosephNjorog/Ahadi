import { NextResponse } from "next/server";
import { z } from "zod";
import { inviteWorker } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { email } = await readJson(req, z.object({ email: z.string().email() }));
  const p = await inviteWorker(actor, params.id, email);
  return NextResponse.json({ state: p.state });
});
