import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RateLimitedError } from "../../src/lib/server/errors";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { defineHandler } from "../../src/lib/server/http";
import { RATE_LIMITS, checkRateLimit } from "../../src/lib/server/ratelimit";

const ORIGIN = "http://127.0.0.1";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires FIRESTORE_EMULATOR_HOST (run via emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  await getAdminFirestore().recursiveDelete(getAdminFirestore().collection("rateLimits"));
  vi.restoreAllMocks();
});

describe("checkRateLimit against the Firestore emulator", () => {
  it("passes under the limit and 429s once over it", async () => {
    const { limit } = RATE_LIMITS.join;
    for (let i = 0; i < limit; i++) {
      await expect(checkRateLimit("join", "over-limit")).resolves.toBeUndefined();
    }
    await expect(checkRateLimit("join", "over-limit")).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("isolates distinct keys", async () => {
    const { limit } = RATE_LIMITS.join;
    for (let i = 0; i < limit; i++) await checkRateLimit("join", "keyA");
    await expect(checkRateLimit("join", "keyA")).rejects.toBeInstanceOf(RateLimitedError);
    await expect(checkRateLimit("join", "keyB")).resolves.toBeUndefined();
  });

  it("resets when the fixed window rolls over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { limit, windowMs } = RATE_LIMITS.join;
      const base = 1_700_000_000_000;
      vi.setSystemTime(base);
      for (let i = 0; i < limit; i++) await checkRateLimit("join", "rollover");
      await expect(checkRateLimit("join", "rollover")).rejects.toBeInstanceOf(RateLimitedError);
      vi.setSystemTime(base + windowMs);
      await expect(checkRateLimit("join", "rollover")).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

const limited = defineHandler({ role: "public", rateLimit: "auth-session" }, async () => ({
  ok: true,
}));

describe("rate limiting through the handler wrapper", () => {
  it("returns 200 under the limit, then a 429 RATE_LIMITED envelope with Retry-After", async () => {
    const { limit } = RATE_LIMITS["auth-session"];
    const make = () =>
      new Request(`${ORIGIN}/api/limited`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-forwarded-for": "203.0.113.7",
        },
      });

    for (let i = 0; i < limit; i++) {
      expect((await limited(make())).status).toBe(200);
    }

    const res = await limited(make());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
  });
});
