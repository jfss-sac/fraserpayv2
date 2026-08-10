import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
const get = vi.fn();
const update = vi.fn();
const doc = vi.fn(() => ({ set, get, update }));
const collection = vi.fn(() => ({ doc }));

vi.mock("./firebase-admin", () => ({
  getAdminFirestore: () => ({ collection }),
}));

vi.mock("./logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { InternalError, RateLimitedError } from "./errors";
import { logger } from "./logger";
import { RATE_LIMITS, checkRateLimit, releaseRateLimit } from "./ratelimit";

beforeEach(() => {
  vi.clearAllMocks();
  set.mockResolvedValue(undefined);
  update.mockResolvedValue(undefined);
  get.mockResolvedValue({ data: () => ({ count: 1 }) });
});

describe("checkRateLimit", () => {
  it("passes when the counter is at or below the limit", async () => {
    get.mockResolvedValue({ data: () => ({ count: RATE_LIMITS.charge.limit }) });
    await expect(checkRateLimit("charge", "u1")).resolves.toEqual({
      scope: "charge",
      docId: expect.stringMatching(/^charge_u1_\d+$/),
    });
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

  it("lets refunded replays buy extra room, one request per refund", async () => {
    const { limit } = RATE_LIMITS.charge;
    get.mockResolvedValue({ data: () => ({ count: limit + 5, refunds: 5 }) });
    await expect(checkRateLimit("charge", "u1")).resolves.toMatchObject({ scope: "charge" });
  });

  it("stops honouring refunds past the window's own limit, capping it at 2x", async () => {
    const { limit } = RATE_LIMITS.charge;
    get.mockResolvedValue({ data: () => ({ count: 2 * limit, refunds: 5 * limit }) });
    await expect(checkRateLimit("charge", "u1")).resolves.toMatchObject({ scope: "charge" });

    get.mockResolvedValue({ data: () => ({ count: 2 * limit + 1, refunds: 5 * limit }) });
    await expect(checkRateLimit("charge", "u1")).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("fails closed (INTERNAL) for money scopes when Firestore is unreachable", async () => {
    set.mockRejectedValue(new Error("emulator down"));
    await expect(checkRateLimit("charge", "u1")).rejects.toBeInstanceOf(InternalError);
    expect(logger.error).toHaveBeenCalled();
  });

  it("fails open for read scopes when Firestore is unreachable", async () => {
    set.mockRejectedValue(new Error("emulator down"));
    await expect(checkRateLimit("reads", "u1")).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("releaseRateLimit", () => {
  it("credits the window the ticket was drawn from, with a single write and no read", async () => {
    const ticket = await checkRateLimit("charge", "u1");
    doc.mockClear();
    get.mockClear();
    await releaseRateLimit(ticket);
    expect(doc).toHaveBeenCalledWith(ticket!.docId);
    expect(update).toHaveBeenCalledWith({ refunds: expect.anything() });
    expect(get).not.toHaveBeenCalled();
  });

  it("leaves count alone so the activity view still sees every request", async () => {
    const ticket = await checkRateLimit("charge", "u1");
    await releaseRateLimit(ticket);
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ count: expect.anything() }));
  });

  it("does nothing when the limiter failed open and issued no ticket", async () => {
    await releaseRateLimit(null);
    expect(update).not.toHaveBeenCalled();
  });

  it("never fails the request when the counter doc is already gone", async () => {
    const ticket = await checkRateLimit("charge", "u1");
    update.mockRejectedValue(new Error("NOT_FOUND"));
    await expect(releaseRateLimit(ticket)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
