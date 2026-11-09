import { NextResponse } from "next/server";
import { z } from "zod";
import { requestMagicLink } from "@ahadi/services";
import { readJson, withPublic } from "@/lib/api";

export const runtime = "nodejs";

const Body = z.object({ email: z.string().email().max(254), next: z.string().max(500).optional() });

export const POST = withPublic(async ({ req }) => {
  const { email, next } = await readJson(req, Body);
  const { devLink } = await requestMagicLink(email, next);
  return NextResponse.json({ ok: true, ...(devLink ? { devLink } : {}) });
});
