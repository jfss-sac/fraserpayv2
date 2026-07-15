import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Resolve the "@/*" tsconfig path alias (Vite supports this natively).
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Keep Playwright E2E specs (added in Phase 6) out of the Vitest run.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
