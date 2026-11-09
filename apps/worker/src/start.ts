import { Worker, type ConnectionOptions } from "bullmq";
import { getEnv } from "@ahadi/core/env";
import { QUEUE_NAME, getQueue, redisConnection } from "@ahadi/queue";
import { log, recordJobFailure } from "@ahadi/services";
import { runJob } from "./handlers";

type Global = typeof globalThis & { __ahadiWorker?: Worker };
const g = globalThis as Global;

/**
 * Starts the BullMQ consumer and the recurring schedulers. Used by the standalone worker
 * process and, on Render's free plan, inside the Next.js server (RUN_WORKER_IN_WEB=true).
 * Idempotent per process.
 */
export async function startWorker(opts: { concurrency?: number } = {}): Promise<Worker> {
  if (g.__ahadiWorker) return g.__ahadiWorker;
  const env = getEnv(); // fail fast on bad config
  log.info({ paypal_env: env.PAYPAL_ENV, demo: env.DEMO_MODE }, "ahadi worker starting");

  // Recurring jobs (SPEC §17). Upsert is idempotent across restarts and multiple instances.
  const queue = getQueue();
  await queue.upsertJobScheduler(
    "authorization-monitor",
    { every: 60 * 60 * 1000 },
    { name: "authorization.monitor", data: {} },
  );
  await queue.upsertJobScheduler(
    "payout-reconcile",
    { every: 15 * 60 * 1000 },
    { name: "payout.reconcile", data: {} },
  );

  const worker = new Worker(QUEUE_NAME, runJob, {
    connection: redisConnection() as unknown as ConnectionOptions,
    concurrency: opts.concurrency ?? Number(process.env.WORKER_CONCURRENCY ?? 5),
  });

  worker.on("completed", (job, result) =>
    log.info({ job_id: job.id, job: job.name, result }, "job completed"),
  );
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const final = err.name === "UnrecoverableError" || job.attemptsMade >= (job.opts.attempts ?? 1);
    log[final ? "error" : "warn"](
      { job_id: job.id, job: job.name, attempt: job.attemptsMade, err: err.message },
      final ? "job dead-lettered" : "job failed, will retry",
    );
    if (final) {
      await recordJobFailure({
        queue: QUEUE_NAME,
        jobName: job.name,
        jobId: job.id,
        data: job.data,
        error: err.message,
        attempts: job.attemptsMade,
      }).catch((e) => log.error({ err: String(e) }, "could not record job failure"));
    }
  });
  worker.on("error", (err) => log.error({ err: err.message }, "worker error"));
  g.__ahadiWorker = worker;
  log.info({ queue: QUEUE_NAME }, "ahadi worker ready");
  return worker;
}
