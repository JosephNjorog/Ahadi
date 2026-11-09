import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelMilestoneFunding } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({ orderId: z.string().min(5).max(64) });

export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { orderId } = await readJson(req, Body);
  await cancelMilestoneFunding(actor, params.id, orderId);
  return NextResponse.json({ ok: true });
});
