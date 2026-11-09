import { NextResponse } from "next/server";
import { listNotifications, markNotificationsRead } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser(async ({ actor }) =>
  NextResponse.json({ notifications: actor.kind === "user" ? await listNotifications(actor.user.id) : [] }),
);
export const POST = withUser(async ({ actor }) => {
  if (actor.kind === "user") await markNotificationsRead(actor.user.id);
  return NextResponse.json({ ok: true });
});
