/**
 * Runs once per Next.js server process. On Render's free plan there is no separate worker
 * service, so RUN_WORKER_IN_WEB=true starts the BullMQ consumer inside the web server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RUN_WORKER_IN_WEB !== "true") return;
  const { startWorker } = await import("@ahadi/worker/start");
  await startWorker({ concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });
}
