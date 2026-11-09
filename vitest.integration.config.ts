import { defineConfig } from "vitest/config";

/** Integration tests: need DATABASE_URL pointing at a disposable Postgres (CI service or local). */
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.int.test.ts", "apps/*/test/**/*.int.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
