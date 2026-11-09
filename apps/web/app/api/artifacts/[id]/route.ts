import { eq } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import { getDb, milestones, promises, submissions } from "@ahadi/db";
import { getArtifactData, isAdmin, partyRole } from "@ahadi/services";
import { withUser } from "@/lib/api";

export const runtime = "nodejs";

/** Evidence and deliverable files, for parties and admins only. Served as attachments except images/PDF. */
export const GET = withUser<{ id: string }>(async ({ actor, params }) => {
  const { artifact, data } = await getArtifactData(params.id);
  if (!artifact.submissionId) throw new AppError("NOT_FOUND", "Artifact not found");
  const [row] = await getDb()
    .select({ p: promises })
    .from(submissions)
    .innerJoin(milestones, eq(milestones.id, submissions.milestoneId))
    .innerJoin(promises, eq(promises.id, milestones.promiseId))
    .where(eq(submissions.id, artifact.submissionId));
  if (!row || (!isAdmin(actor) && !partyRole(actor, row.p)))
    throw new AppError("NOT_FOUND", "Artifact not found");
  const inline = /^image\/(png|jpeg|webp|gif)$|^application\/pdf$|^application\/json$|^text\/plain$/.test(
    artifact.mime,
  );
  const name = String(
    (artifact.meta as { fileName?: string; key?: string } | null)?.fileName ??
      (artifact.meta as { key?: string } | null)?.key ??
      artifact.id,
  ).replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": inline ? artifact.mime : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "cache-control": "private, max-age=3600, immutable",
      "x-ahadi-sha256": artifact.sha256,
    },
  });
});
