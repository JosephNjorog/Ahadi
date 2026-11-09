import { NextResponse } from "next/server";
import { getVerificationView } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withUser<{ id: string }>(async ({ actor, params }) =>
  NextResponse.json(await getVerificationView(actor, params.id)),
);
