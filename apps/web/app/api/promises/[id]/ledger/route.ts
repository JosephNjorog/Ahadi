import { NextResponse } from "next/server";
import { getPromiseLedger } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ actor, params }) => {
  const { events, verification } = await getPromiseLedger(actor, params.id);
  return NextResponse.json({ events, verification });
});
