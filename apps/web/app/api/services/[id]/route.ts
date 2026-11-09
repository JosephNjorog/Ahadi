import { NextResponse } from "next/server";
import { updateService } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const PATCH = withUser<{ id: string }>(async ({ req, actor, params }) =>
  NextResponse.json({ service: await updateService(actor, params.id, await req.json().catch(() => ({}))) }),
);
