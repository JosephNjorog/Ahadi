import { NextResponse } from "next/server";
import { createPromise, listPromisesForActor } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser(async ({ actor }) =>
  NextResponse.json({ promises: await listPromisesForActor(actor) }),
);

/** SPEC §16: create from a text brief. The Contract Architect drafts terms in the background. */
export const POST = withUser(async ({ req, actor }) => {
  const p = await createPromise(actor, await req.json().catch(() => ({})));
  return NextResponse.json({ promiseId: p.id }, { status: 201 });
});
