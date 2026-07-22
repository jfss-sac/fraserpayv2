import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Resolve the "@/*" tsconfig path alias (Vite supports this natively).
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Keep Playwright E2E specs (added in Phase 6) out of the Vitest run.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      ...configDefaults.exclude,
      "tests/integration/**",
      "src/**/*.integration.{test,spec}.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/shared/money.ts", "src/lib/server/money/invariants.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        "src/lib/shared/money.ts": { branches: 100 },
        "src/lib/server/money/invariants.ts": { branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
