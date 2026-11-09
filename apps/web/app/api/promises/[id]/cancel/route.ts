import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelPromise } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().max(500).default("") }));
  await cancelPromise(actor, params.id, reason);
  return NextResponse.json({ ok: true });
});
