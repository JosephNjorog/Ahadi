import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import { getDb, users } from "@ahadi/db";
import { buildStatement } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** Machine-verifiable statement: { doc, signature, kid, publicKey }. Verify Ed25519 over canonical JSON of doc. */
export const GET = withUser<{ slug: string }>(async ({ actor, params }) => {
  const [u] = await getDb().select().from(users).where(eq(users.passportSlug, params.slug));
  if (!u || actor.kind !== "user" || (actor.user.id !== u.id && actor.user.role !== "admin"))
    throw new AppError("FORBIDDEN", "Only the passport owner can download their statement");
  return NextResponse.json(await buildStatement(u.id));
});
