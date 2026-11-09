import { NextResponse } from "next/server";
import { adminGridRows } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

export const GET = withUser(async () => NextResponse.json({ rows: await adminGridRows() }), { admin: true });
