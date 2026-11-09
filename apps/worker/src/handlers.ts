import { UnrecoverableError, type Job } from "bullmq";
import { isAppError } from "@ahadi/core";
import { PayPalError } from "@ahadi/paypal";
import type { JobName, JobPayloads } from "@ahadi/queue";
import {
  anchorLedgers,
  deliverNotification,
  dispatchProviderEvent,
  executeSettlement,
  expireObjectionWindow,
  generateTerms,
  handleWhatsAppMessage,
  monitorAuthorizations,
  processWebhookEvent,
  recomputePassport,
  reconcilePayouts,
  runCritique,
  runKazi,
  runMediation,
  runVerification,
  scoreRisk,
  sendPayout,
  sweepObjectionWindows,
} from "@ahadi/services";

type Handler<N extends JobName> = (data: JobPayloads[N], job: Job) => Promise<unknown>;

/** Every queue job in SPEC §17. */
export const handlers: { [N in JobName]: Handler<N> } = {
  "webhook.process": (d) => processWebhookEvent(d.eventId),
  "settlement.execute": (d) => executeSettlement(d.proposalId),
  "payout.send": (d) => sendPayout(d.settlementId),
  "payout.reconcile": (d) => reconcilePayouts(d.settlementId),
  "authorization.monitor": () => monitorAuthorizations(),
  "contract.generate": (d) =>
    generateTerms(d.promiseId, d.editRequest, d.authorId).then((v) =>
      v ? { version: v.version } : "skipped",
    ),
  "critique.run": (d) => runCritique(d.termsVersionId).then((c) => (c ? "critiqued" : "skipped")),
  "verification.run": (d) => runVerification(d.submissionId),
  "objection.expire": (d) => expireObjectionWindow(d.proposalId),
  "objection.sweep": () => sweepObjectionWindows(),
  "mediation.run": (d) => runMediation(d.mediationId),
  "risk.score": (d) => scoreRisk(d.promiseId, d.trigger),
  "passport.recompute": (d) => recomputePassport(d.userId).then((p) => ({ slug: p.slug, score: p.score })),
  "notify.send": (d) => deliverNotification(d.notificationId),
  "provider.dispatch": (d) => dispatchProviderEvent(d.promiseId, d.milestoneId, d.event),
  "kazi.run": (d) => runKazi(d.promiseId, d.milestoneId),
  "whatsapp.inbound": (d) => handleWhatsAppMessage(d.messageId),
  "ledger.anchor": () => anchorLedgers(),
};

/** Business-rule errors don't retry (SPEC §17); PayPal network/5xx errors and unexpected errors back off. */
export async function runJob(job: Job) {
  const handler = handlers[job.name as JobName] as Handler<JobName> | undefined;
  if (!handler) throw new UnrecoverableError(`Unknown job ${job.name}`);
  try {
    return await handler(job.data, job);
  } catch (e) {
    if (e instanceof PayPalError && e.retryable) throw e;
    if (e instanceof PayPalError || isAppError(e)) throw new UnrecoverableError(e.message);
    throw e;
  }
}
