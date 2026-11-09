import { NextResponse } from "next/server";
import { updateProfile } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser(async ({ actor }) => {
  if (actor.kind !== "user") throw new Error("unreachable");
  return NextResponse.json({ user: actor.user });
});

export const PUT = withUser(async ({ req, actor }) => {
  if (actor.kind !== "user") throw new Error("unreachable");
  const user = await updateProfile(actor.user.id, await req.json().catch(() => ({})));
  return NextResponse.json({ user: { id: user.id, displayName: user.displayName, paypalEmail: user.paypalEmail, country: user.country } });
});
