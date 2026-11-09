import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

/**
 * Queue definitions shared by the web app (producer) and the worker (consumer). SPEC §17.
 * Every job has a deterministic id so enqueueing the same thing twice is a no-op.
 */

export const QUEUE_NAME = "ahadi";

export interface JobPayloads {
  "webhook.process": { eventId: string };
  "settlement.execute": { proposalId: string };
  "payout.send": { settlementId: string };
  "payout.reconcile": { settlementId?: string };
  "authorization.monitor": Record<string, never>;
}
export type JobName = keyof JobPayloads;

/** BullMQ forbids ':' in custom ids, so keys use '-'. */
export function jobIdFor<N extends JobName>(name: N, data: JobPayloads[N]): string | undefined {
  switch (name) {
    case "webhook.process":
      return `webhook-${(data as JobPayloads["webhook.process"]).eventId}`;
    case "settlement.execute":
      return `settle-${(data as JobPayloads["settlement.execute"]).proposalId}`;
    case "payout.send":
      return `payout-${(data as JobPayloads["payout.send"]).settlementId}`;
    default:
      return undefined;
  }
}

/** Retries: exponential backoff, 5 attempts (PayPal network errors). Business errors fail fast in the handler. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

type Global = typeof globalThis & { __ahadiRedis?: IORedis; __ahadiQueue?: Queue };
const g = globalThis as Global;

export function redisConnection(url = process.env.REDIS_URL ?? "redis://localhost:6379"): IORedis {
  return new IORedis(url, {
    // Required by BullMQ for blocking connections.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Render Key Value / Upstash use TLS via rediss://
    ...(url.startsWith("rediss://") ? { tls: {} } : {}),
  });
}

export function getQueue(): Queue {
  if (g.__ahadiQueue) return g.__ahadiQueue;
  g.__ahadiRedis ??= redisConnection();
  g.__ahadiQueue = new Queue(QUEUE_NAME, {
    connection: g.__ahadiRedis as unknown as ConnectionOptions,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return g.__ahadiQueue;
}

export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: JobsOptions = {}) {
  const jobId = opts.jobId ?? jobIdFor(name, data);
  return getQueue().add(name, data, { ...opts, ...(jobId ? { jobId } : {}) });
}

export async function closeQueue() {
  await g.__ahadiQueue?.close();
  await g.__ahadiRedis?.quit();
  g.__ahadiQueue = undefined;
  g.__ahadiRedis = undefined;
}
