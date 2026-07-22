import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.{test,spec}.ts", "src/**/*.integration.{test,spec}.ts"],
    globalSetup: ["./tests/integration/verify-ledger.globalsetup.ts"],
    passWithNoTests: true,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/lib/server/money/**"],
      exclude: ["**/*.{test,spec}.{ts,tsx}", "src/lib/server/money/invariants.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        "src/lib/server/money/**": { branches: 93, functions: 100, lines: 100, statements: 99 },
      },
    },
  },
});
