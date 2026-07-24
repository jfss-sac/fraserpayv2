import { readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

function loadEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;
const demoEnv = loadEnvFile("./.env.demo");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    storageState: "e2e/.auth/operator.json",
    trace: "on-first-retry",
  },
  projects: [{ name: "mobile-chrome", use: { ...devices["Pixel 5"] } }],
  webServer: {
    command: "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...demoEnv, PORT: String(PORT) },
  },
});
