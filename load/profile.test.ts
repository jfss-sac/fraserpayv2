import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "../src/lib/server/ratelimit";
import {
  ASSUMED_LIMITS,
  DEFAULT_PROFILE,
  MAX_CAP_UTILISATION,
  SCOPES,
  capUtilisation,
  perUidPerMinute,
  profileViolations,
} from "./profile.js";

const SCOPE_NAMES = ["charge", "lookup", "topup"] as const;

const assumedLimits: Record<string, { limit: number; windowMs: number }> = ASSUMED_LIMITS;

describe("k6 lunch-rush profile", () => {
  it("covers exactly the scopes the load script drives", () => {
    expect(SCOPES).toEqual([...SCOPE_NAMES]);
  });

  it("assumes the rate limits the app actually enforces", () => {
    for (const scope of SCOPE_NAMES) {
      expect(assumedLimits[scope]).toEqual({
        limit: RATE_LIMITS[scope].limit,
        windowMs: RATE_LIMITS[scope].windowMs,
      });
    }
  });

  it("matches the seed's default pool sizes", () => {
    expect(DEFAULT_PROFILE.sellerPool).toBe(40 * 2);
    expect(DEFAULT_PROFILE.sacPool).toBe(4);
  });

  it("drives at least one lookup per charge, as the POS flow forces", () => {
    expect(DEFAULT_PROFILE.lookupsPerCharge).toBeGreaterThanOrEqual(1);
    expect(profileViolations(DEFAULT_PROFILE)).toEqual([]);
  });

  it("rejects a profile whose lookups trail its charges", () => {
    const backwards = { ...DEFAULT_PROFILE, lookupsPerCharge: 0.2 };
    expect(profileViolations(backwards)).toContainEqual(
      expect.stringContaining("lookups can never trail charges"),
    );
  });

  it("leaves every scope well under its cap, so NFR-5 measures the app not the limiter", () => {
    const utilisation = capUtilisation(DEFAULT_PROFILE);
    for (const scope of SCOPE_NAMES) {
      expect(utilisation[scope]).toBeLessThanOrEqual(MAX_CAP_UTILISATION);
    }
    expect(perUidPerMinute(DEFAULT_PROFILE)).toEqual({ charge: 7.5, lookup: 22.5, topup: 7.5 });
  });

  it("rejects a seller pool narrow enough to measure the rate limiter", () => {
    const concentrated = { ...DEFAULT_PROFILE, sellerPool: 6 };
    expect(profileViolations(concentrated)).toContainEqual(
      expect.stringContaining("measures the rate limiter, not the app"),
    );
  });
});
