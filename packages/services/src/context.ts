import { eq } from "drizzle-orm";
import { AppError } from "@ahadi/core";
import {
  milestones,
  promises,
  proposals,
  settlements,
  submissions,
  verifications,
  type DbOrTx,
} from "@ahadi/db";

/** proposal → verification → submission → milestone → promise (+ settlement if any). */
export async function loadProposalContext(db: DbOrTx, proposalId: string) {
  const [row] = await db
    .select({
      proposal: proposals,
      verification: verifications,
      submission: submissions,
      milestone: milestones,
      promise: promises,
    })
    .from(proposals)
    .innerJoin(verifications, eq(verifications.id, proposals.verificationId))
    .innerJoin(submissions, eq(submissions.id, verifications.submissionId))
    .innerJoin(milestones, eq(milestones.id, submissions.milestoneId))
    .innerJoin(promises, eq(promises.id, milestones.promiseId))
    .where(eq(proposals.id, proposalId));
  if (!row) throw new AppError("NOT_FOUND", `Proposal ${proposalId} not found`);
  const [settlement] = await db.select().from(settlements).where(eq(settlements.proposalId, proposalId));
  return { ...row, settlement };
}

export async function loadSettlementContext(db: DbOrTx, settlementId: string) {
  const [s] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
  if (!s) throw new AppError("NOT_FOUND", `Settlement ${settlementId} not found`);
  return loadProposalContext(db, s.proposalId);
}
