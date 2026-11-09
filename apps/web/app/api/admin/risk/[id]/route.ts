import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveRiskFlag } from "@ahadi/services";
import { readJson, withUser } from "@/lib/api";

export const runtime = "nodejs";

export const POST = withUser<{ id: string }>(
  async ({ req, actor, params }) => {
    const { note } = await readJson(req, z.object({ note: z.string().trim().min(3).max(500) }));
    return NextResponse.json({
      flag: await resolveRiskFlag(params.id, actor.kind === "user" ? actor.user.id : "system", note),
    });
  },
  { admin: true },
);
