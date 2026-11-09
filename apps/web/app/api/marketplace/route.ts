import { NextResponse } from "next/server";
import { searchProviders } from "@ahadi/services";
import { withPublic } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withPublic(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  return NextResponse.json({
    providers: await searchProviders({
      category: sp.get("category") || undefined,
      query: sp.get("q") || undefined,
      maxPriceUsd: num("maxPriceUsd"),
      minScore: num("minScore"),
    }),
  });
});
