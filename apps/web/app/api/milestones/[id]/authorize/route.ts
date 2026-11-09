import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeMilestoneOrder } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({ orderId: z.string().min(5).max(64) });

/** SPEC §6.3 step 2: authorize the approved order → "Funds secured". */
export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { orderId } = await readJson(req, Body);
  const funding = await authorizeMilestoneOrder(actor, params.id, orderId);
  return NextResponse.json({
    status: funding.status,
    authorizationId: funding.paypalAuthorizationId,
    amountMinor: funding.amountMinor,
    currency: funding.currency,
    honorExpiresAt: funding.honorExpiresAt,
    expiresAt: funding.expiresAt,
  });
});
