import { NextResponse } from "next/server";
import { z } from "zod";
import { demoUser } from "@ahadi/services";
import { readJson, withPublic } from "@/lib/api";
import { setSession } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({ role: z.enum(["client", "worker", "admin"]) });

export const POST = withPublic(async ({ req }) => {
  const { role } = await readJson(req, Body);
  const user = await demoUser(role);
  await setSession(user.id);
  return NextResponse.json({ ok: true, user: { id: user.id, displayName: user.displayName, role: user.role } });
});
