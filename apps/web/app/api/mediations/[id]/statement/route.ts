import { NextResponse } from "next/server";
import { z } from "zod";
import { addStatement } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(async ({ req, actor, params }) => {
  const { statement } = await readJson(req, z.object({ statement: z.string() }));
  await addStatement(actor, params.id, statement);
  return NextResponse.json({ ok: true });
});
