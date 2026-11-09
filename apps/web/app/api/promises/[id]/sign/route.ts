import { NextResponse } from "next/server";
import { z } from "zod";
import { signTerms } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { bodyHash } = await readJson(req, z.object({ bodyHash: z.string().regex(/^[0-9a-f]{64}$/) }));
  return NextResponse.json(await signTerms(actor, params.id, bodyHash));
});
