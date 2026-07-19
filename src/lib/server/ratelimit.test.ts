import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const get = vi.fn();
const doc = vi.fn(() => ({ set, get }));
const collection = vi.fn(() => ({ doc }));

vi.mock("./firebase-admin", () => ({
  getAdminFirestore: () => ({ collection }),
}));

vi.mock("./logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { InternalError, RateLimitedError } from "./errors";
import { logger } from "./logger";
import { RATE_LIMITS, checkRateLimit } from "./ratelimit";

beforeEach(() => {
  vi.clearAllMocks();
  set.mockResolvedValue(undefined);
  get.mockResolvedValue({ data: () => ({ count: 1 }) });
});

describe("checkRateLimit", () => {
  it("passes when the counter is at or below the limit", async () => {
    get.mockResolvedValue({ data: () => ({ count: RATE_LIMITS.charge.limit }) });
    await expect(checkRateLimit("charge", "u1")).resolves.toBeUndefined();
  });

  it("throws RATE_LIMITED with a positive Retry-After once over the limit", async () => {
    get.mockResolvedValue({ data: () => ({ count: RATE_LIMITS.charge.limit + 1 }) });
    const err = await checkRateLimit("charge", "u1").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    expect(err.headers()?.["retry-after"]).toBe(String(err.retryAfterSeconds));
  });

  it("keys the counter doc by scope, key, and window start", async () => {
    await checkRateLimit("charge", "u9");
    expect(doc).toHaveBeenCalledWith(expect.stringMatching(/^charge_u9_\d+$/));
  });

  it("fails closed (INTERNAL) for money scopes when Firestore is unreachable", async () => {
    set.mockRejectedValue(new Error("emulator down"));
    await expect(checkRateLimit("charge", "u1")).rejects.toBeInstanceOf(InternalError);
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails open for read scopes when Firestore is unreachable", async () => {
    set.mockRejectedValue(new Error("emulator down"));
    await expect(checkRateLimit("reads", "u1")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
