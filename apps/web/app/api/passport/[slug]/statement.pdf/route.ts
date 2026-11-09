import { eq } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import { getDb, users } from "@ahadi/db";
import { statementPdf } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** Source-of-funds statement — owner only (SPEC §16). */
export const GET = withUser<{ slug: string }>(async ({ actor, params }) => {
  const [u] = await getDb().select().from(users).where(eq(users.passportSlug, params.slug));
  if (!u || actor.kind !== "user" || (actor.user.id !== u.id && actor.user.role !== "admin"))
    throw new AppError("FORBIDDEN", "Only the passport owner can download their statement");
  const pdf = await statementPdf(u.id);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="ahadi-statement-${params.slug}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
});
