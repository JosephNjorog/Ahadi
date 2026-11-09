import { closeDb } from "@ahadi/db";
import { closeQueue } from "@ahadi/queue";
import { log } from "@ahadi/services";
import { startWorker } from "./start";

process.env.AHADI_SERVICE ??= "worker";

async function main() {
  const worker = await startWorker();
  const shutdown = async (signal: string) => {
    log.info({ signal }, "worker shutting down");
    await worker.close();
    await closeQueue();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((e) => {
  log.fatal({ err: e instanceof Error ? e.message : String(e) }, "worker failed to start");
  process.exit(1);
});
