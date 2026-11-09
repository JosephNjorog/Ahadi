import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import { artifacts, getDb, type Artifact, type DbOrTx } from "@ahadi/db";

/**
 * Artifact storage. Deliverables and evidence are content-addressed (sha256) and stored inline in
 * Postgres (bytea) — no extra service to run on the free tier. Hashes go into the ledger, so any
 * later change to an artifact is detectable.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SUBMISSION_BYTES = 25 * 1024 * 1024;

export function sha256(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

export async function storeArtifact(
  db: DbOrTx,
  a: {
    submissionId?: string | null;
    verificationId?: string | null;
    role: "deliverable" | "evidence";
    kind: string;
    mime: string;
    data: Buffer;
    meta?: Record<string, unknown>;
  },
): Promise<Artifact> {
  if (a.data.length > MAX_FILE_BYTES * 2) throw new AppError("VALIDATION_FAILED", "Artifact too large");
  const hash = sha256(a.data);
  const [row] = await db
    .insert(artifacts)
    .values({
      submissionId: a.submissionId ?? null,
      verificationId: a.verificationId ?? null,
      role: a.role,
      kind: a.kind,
      storageKey: `db:${hash}`,
      sha256: hash,
      mime: a.mime,
      bytes: a.data.length,
      meta: a.meta ?? null,
      data: a.data,
    })
    .returning();
  return row!;
}

export async function getArtifactData(
  id: string,
): Promise<{ artifact: Omit<Artifact, "data">; data: Buffer }> {
  const [row] = await getDb().select().from(artifacts).where(eq(artifacts.id, id));
  if (!row || !row.data) throw new AppError("NOT_FOUND", "Artifact not found");
  const { data, ...artifact } = row;
  return { artifact, data };
}

/** Metadata only (no blobs) for listings. */
export async function listArtifactsMeta(ids: string[]) {
  if (!ids.length) return [];
  return getDb()
    .select({
      id: artifacts.id,
      role: artifacts.role,
      kind: artifacts.kind,
      mime: artifacts.mime,
      bytes: artifacts.bytes,
      sha256: artifacts.sha256,
      meta: artifacts.meta,
      submissionId: artifacts.submissionId,
      verificationId: artifacts.verificationId,
      createdAt: artifacts.createdAt,
    })
    .from(artifacts)
    .where(inArray(artifacts.id, ids));
}
