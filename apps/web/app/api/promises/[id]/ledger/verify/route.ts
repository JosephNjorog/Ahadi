import { NextResponse } from "next/server";
import { getPromiseLedger } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** SPEC §11.2: recompute the chain and return { valid, brokenAt? }. */
export const GET = withUser<{ id: string }>(async ({ actor, params }) => {
  const { verification } = await getPromiseLedger(actor, params.id);
  return NextResponse.json(verification);
});
