import { NextResponse } from "next/server";
import { createAgent, listAgents } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser(async ({ actor }) => NextResponse.json({ agents: await listAgents(actor) }));

/** SPEC §16: create agent + API key (shown once). */
export const POST = withUser(async ({ req, actor }) =>
  NextResponse.json(await createAgent(actor, await req.json().catch(() => ({}))), { status: 201 }),
);
