import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usingEmulators } from "./emulator-mode";

const HOSTS = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of HOSTS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of HOSTS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("usingEmulators", () => {
  it("reports cloud when no emulator host is set", () => {
    expect(usingEmulators(["auth", "firestore"])).toBe(false);
    expect(usingEmulators(["firestore"])).toBe(false);
  });

  it("reports emulated when every required host is set", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    expect(usingEmulators(["auth", "firestore"])).toBe(true);
    expect(usingEmulators(["firestore"])).toBe(true);
  });

  it("allows a Firestore-only process under a Firestore-only emulator run", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    expect(usingEmulators(["firestore"])).toBe(true);
  });

  it("refuses when Auth is emulated but Firestore would stay on the cloud project", () => {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
    expect(() => usingEmulators(["auth", "firestore"])).toThrow(/FIRESTORE_EMULATOR_HOST/);
    expect(() => usingEmulators(["firestore"])).toThrow(/FIRESTORE_EMULATOR_HOST/);
  });

  it("refuses when Firestore is emulated but Auth would stay on the cloud project", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    expect(() => usingEmulators(["auth", "firestore"])).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
  });

  it("treats a blank host as unset", () => {
    process.env.FIRESTORE_EMULATOR_HOST = "";
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "";
    expect(usingEmulators(["auth", "firestore"])).toBe(false);
  });
});
