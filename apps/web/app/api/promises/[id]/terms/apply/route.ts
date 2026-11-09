import { NextResponse } from "next/server";
import { z } from "zod";
import { applyCritiqueSuggestion } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { issueIndex } = await readJson(req, z.object({ issueIndex: z.number().int().min(0) }));
  return NextResponse.json(await applyCritiqueSuggestion(actor, params.id, issueIndex));
});
