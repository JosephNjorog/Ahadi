import { defineConfig } from "vitest/config";

/** Unit tests: pure, no network, no database. Integration tests live in *.int.test.ts. */
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    exclude: ["**/*.int.test.ts", "**/node_modules/**"],
    environment: "node",
  },
});
