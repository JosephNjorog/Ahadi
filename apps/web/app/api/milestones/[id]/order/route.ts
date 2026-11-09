import { NextResponse } from "next/server";
import { createMilestoneOrder } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** SPEC §6.3 step 1: create the PayPal order (intent AUTHORIZE). Returns the order id to the JS SDK. */
export const POST = withUser<{ id: string }>(async ({ actor, params }) => {
  const { orderId } = await createMilestoneOrder(actor, params.id);
  return NextResponse.json({ orderId });
});
