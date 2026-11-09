import { NextResponse } from "next/server";
import { listTermsVersions, proposeTermsEdit } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ params }) =>
  NextResponse.json({ versions: await listTermsVersions(params.id) }),
);

/** SPEC §16: propose an edit — { instruction } (Architect revises) or { body } (hand-edited terms). */
export const POST = withUser<{ id: string }>(async ({ req, actor, params }) =>
  NextResponse.json(await proposeTermsEdit(actor, params.id, await req.json().catch(() => ({})))),
);
