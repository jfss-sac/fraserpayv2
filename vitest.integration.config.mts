import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.{test,spec}.ts", "src/**/*.integration.{test,spec}.ts"],
    passWithNoTests: true,
    fileParallelism: false,
  },
});
