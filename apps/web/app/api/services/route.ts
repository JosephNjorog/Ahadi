import { NextResponse } from "next/server";
import { createService, myServices } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser(async ({ actor }) => NextResponse.json({ services: await myServices(actor) }));
export const POST = withUser(async ({ req, actor }) =>
  NextResponse.json(
    { service: await createService(actor, await req.json().catch(() => ({}))) },
    { status: 201 },
  ),
);
