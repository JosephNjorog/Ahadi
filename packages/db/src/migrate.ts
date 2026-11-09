import { config } from "dotenv";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDb } from "./client";

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

export async function runMigrations(url?: string) {
  const target = url ?? (process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
  if (!target) throw new Error("Set DATABASE_URL_UNPOOLED (Neon direct endpoint) or DATABASE_URL");
  const { db, pool } = createDb(target, 1);
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const host = new URL(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "postgres://x")
    .hostname;
  console.log(`Running migrations against ${host} …`);
  runMigrations()
    .then(() => console.log("Migrations complete."))
    .catch((e) => {
      console.error("Migration failed:", e);
      process.exit(1);
    });
}
