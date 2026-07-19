import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN_ENV = [
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "GCLOUD_PROJECT",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ADMIN_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of ADMIN_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("getAdminApp", () => {
  it("throws when neither emulator nor credentials are configured", async () => {
    const mod = await import("./firebase-admin");
    expect(() => mod.getAdminApp()).toThrow(/credentials/i);
  });

  it("initializes with a projectId only when emulator env is set, and caches it", async () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.GCLOUD_PROJECT = "demo-fraserpay";
    const mod = await import("./firebase-admin");
    const app = mod.getAdminApp();
    expect(app.options.projectId).toBe("demo-fraserpay");
    expect(mod.getAdminApp()).toBe(app);
  });
});
