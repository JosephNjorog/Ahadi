import { NextResponse } from "next/server";
import { getPassportBySlug } from "@ahadi/services";
import { withPublic } from "@/lib/api";

export const runtime = "nodejs";

/** Public Passport JSON (SPEC §15). */
export const GET = withPublic<{ slug: string }>(async ({ params }) =>
  NextResponse.json(await getPassportBySlug(params.slug), {
    headers: { "cache-control": "public, max-age=300" },
  }),
);
