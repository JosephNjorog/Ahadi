import { NextResponse } from "next/server";
import { getPromiseDetail } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser<{ id: string }>(async ({ actor, params }) =>
  NextResponse.json(await getPromiseDetail(actor, params.id)),
);
