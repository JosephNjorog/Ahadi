import { UnrecoverableError, type Job } from "bullmq";
import { isAppError } from "@ahadi/core";
import { PayPalError } from "@ahadi/paypal";
import type { JobName, JobPayloads } from "@ahadi/queue";
import {
  executeSettlement,
  monitorAuthorizations,
  processWebhookEvent,
  reconcilePayouts,
  sendPayout,
} from "@ahadi/services";

type Handler<N extends JobName> = (data: JobPayloads[N], job: Job) => Promise<unknown>;

export const handlers: { [N in JobName]: Handler<N> } = {
  "webhook.process": (d) => processWebhookEvent(d.eventId),
  "settlement.execute": (d) => executeSettlement(d.proposalId),
  "payout.send": (d) => sendPayout(d.settlementId),
  "payout.reconcile": (d) => reconcilePayouts(d.settlementId),
  "authorization.monitor": () => monitorAuthorizations(),
};

/**
 * SPEC §17 retries: exponential backoff for PayPal network/5xx errors, none for business-rule errors.
 * Business errors become UnrecoverableError so BullMQ skips the remaining attempts.
 */
export async function runJob(job: Job) {
  const handler = handlers[job.name as JobName] as Handler<JobName> | undefined;
  if (!handler) throw new UnrecoverableError(`Unknown job ${job.name}`);
  try {
    return await handler(job.data, job);
  } catch (e) {
    if (e instanceof PayPalError && e.retryable) throw e;
    if (e instanceof PayPalError || isAppError(e)) throw new UnrecoverableError(e.message);
    throw e; // unexpected (DB blip, bug): retry with backoff
  }
}
