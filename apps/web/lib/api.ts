import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, isAppError } from "@ahadi/core";
import { getEnv } from "@ahadi/core/env";
import { PayPalError } from "@ahadi/paypal";
import { log, type Actor } from "@ahadi/services";
import { currentUser } from "./auth";

type Ctx<P> = { params: Promise<P> };

export function errorResponse(e: unknown) {
  if (isAppError(e)) return NextResponse.json(e.toJSON(), { status: e.status });
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Invalid request", details: e.flatten() } },
      { status: 422 },
    );
  }
  if (e instanceof PayPalError) {
    log.warn({ err: e.toJSON() }, "paypal error surfaced to API");
    const status = e.status >= 400 && e.status < 500 ? 422 : 502;
    return NextResponse.json(
      {
        error: {
          code: "PAYPAL_ERROR",
          message: friendlyPayPalMessage(e),
          details: { name: e.paypalName, issue: e.issue, debugId: e.debugId },
        },
      },
      { status },
    );
  }
  log.error(
    { err: e instanceof Error ? { message: e.message, stack: e.stack } : String(e) },
    "unhandled API error",
  );
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
    { status: 500 },
  );
}

function friendlyPayPalMessage(e: PayPalError) {
  switch (e.issue) {
    case "INSTRUMENT_DECLINED":
      return "PayPal declined that payment method. Please choose another one.";
    case "ORDER_NOT_APPROVED":
      return "The payment wasn't approved in PayPal yet.";
    case "PAYER_ACTION_REQUIRED":
      return "PayPal needs you to finish an extra step. Please try again.";
    default:
      return e.operation === "oauth.token"
        ? "Ahadi couldn't reach PayPal (credentials). An admin has been notified."
        : `PayPal: ${e.message}`;
  }
}

/** Reject cross-site state-changing requests (cookie auth + CSRF). */
function assertSameOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, server-to-server) don't send Origin
  const allowed = new Set([new URL(getEnv().APP_URL).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw new AppError("FORBIDDEN", "Cross-origin request rejected");
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("VALIDATION_FAILED", "Request body must be JSON");
  }
  return schema.parse(body);
}

/** Wrap an authenticated route handler. */
export function withUser<P = Record<string, string>>(
  handler: (args: { req: NextRequest; actor: Actor; params: P }) => Promise<Response>,
  opts: { admin?: boolean } = {},
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      assertSameOrigin(req);
      const user = await currentUser();
      if (!user) throw new AppError("UNAUTHENTICATED", "Please sign in");
      if (opts.admin && user.role !== "admin") throw new AppError("FORBIDDEN", "Admin only");
      return await handler({ req, actor: { kind: "user", user }, params: await ctx.params });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function withPublic<P = Record<string, string>>(
  handler: (args: { req: NextRequest; params: P }) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      assertSameOrigin(req);
      return await handler({ req, params: await ctx.params });
    } catch (e) {
      return errorResponse(e);
    }
  };
}
