import { Worker, type ConnectionOptions } from "bullmq";
import { getEnv } from "@ahadi/core/env";
import { closeDb } from "@ahadi/db";
import { QUEUE_NAME, closeQueue, getQueue, redisConnection } from "@ahadi/queue";
import { log, recordJobFailure } from "@ahadi/services";
import { runJob } from "./handlers";

process.env.AHADI_SERVICE ??= "worker";

async function main() {
  const env = getEnv(); // fail fast on bad config
  log.info({ paypal_env: env.PAYPAL_ENV, demo: env.DEMO_MODE }, "ahadi worker starting");

  // Recurring jobs (SPEC §17). upsert is idempotent across restarts and multiple instances.
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

  const connection = redisConnection() as unknown as ConnectionOptions;
  const worker = new Worker(QUEUE_NAME, runJob, {
    connection,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  });

  worker.on("completed", (job, result) => {
    log.info({ job_id: job.id, job: job.name, result }, "job completed");
  });
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

  const shutdown = async (signal: string) => {
    log.info({ signal }, "worker shutting down");
    await worker.close();
    await closeQueue();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  log.info({ queue: QUEUE_NAME }, "ahadi worker ready");
}

main().catch((e) => {
  log.fatal({ err: e instanceof Error ? e.message : String(e) }, "worker failed to start");
  process.exit(1);
});
