import { NextResponse } from "next/server";
import { resolveJobFailure } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const DELETE = withUser<{ id: string }>(
  async ({ actor, params }) => {
    await resolveJobFailure(actor, params.id);
    return NextResponse.json({ ok: true });
  },
  { admin: true },
);
