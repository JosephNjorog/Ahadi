import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@ahadi/core/env";
import { consumeMagicLink } from "@ahadi/services";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const base = getEnv().APP_URL;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const nextParam = req.nextUrl.searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  try {
    const user = await consumeMagicLink(token);
    const res = NextResponse.redirect(new URL(next, base));
    res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions());
    return res;
  } catch {
    return NextResponse.redirect(new URL("/sign-in?error=link", base));
  }
}
