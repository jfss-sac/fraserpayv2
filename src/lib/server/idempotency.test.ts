import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors";
import {
  IDEMPOTENCY_HEADER,
  buildIdempotencyContext,
  extractIdempotencyKey,
  requestHash,
} from "./idempotency";

const KEY = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

function reqWith(key?: string): Request {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers[IDEMPOTENCY_HEADER] = key;
  return new Request("http://localhost/api/sac/topup", { method: "POST", headers });
}

describe("extractIdempotencyKey", () => {
  it("returns a valid UUID v4 key", () => {
    expect(extractIdempotencyKey(reqWith(KEY))).toBe(KEY);
  });

  it("accepts uppercase UUID v4", () => {
    expect(extractIdempotencyKey(reqWith(KEY.toUpperCase()))).toBe(KEY.toUpperCase());
  });

  it("throws VALIDATION when the header is missing", () => {
    expect(() => extractIdempotencyKey(reqWith())).toThrow(ValidationError);
  });

  it("throws VALIDATION for a non-UUID value", () => {
    expect(() => extractIdempotencyKey(reqWith("not-a-uuid"))).toThrow(ValidationError);
  });

  it("throws VALIDATION for a non-v4 UUID", () => {
    expect(() => extractIdempotencyKey(reqWith("f47ac10b-58cc-1372-a567-0e02b2c3d479"))).toThrow(
      ValidationError,
    );
  });
});

describe("requestHash", () => {
  it("is stable across key order (canonical body)", () => {
    expect(requestHash({ a: 1, b: 2 })).toBe(requestHash({ b: 2, a: 1 }));
  });

  it("is stable across nested key order", () => {
    expect(requestHash({ outer: { a: 1, b: 2 }, list: [1, 2] })).toBe(
      requestHash({ list: [1, 2], outer: { b: 2, a: 1 } }),
    );
  });

  it("differs when a value differs", () => {
    expect(requestHash({ amountCents: 5000 })).not.toBe(requestHash({ amountCents: 5050 }));
  });

  it("is order-sensitive for arrays", () => {
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });

  it("produces a 64-char hex digest", () => {
    expect(requestHash({ any: "body" })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buildIdempotencyContext", () => {
  it("scopes the doc id per actor and derives the request hash", () => {
    const ctx = buildIdempotencyContext({
      request: reqWith(KEY),
      actorUid: "actor-1",
      endpoint: "/api/sac/topup",
      body: { amountCents: 5000 },
    });
    expect(ctx).toEqual({
      key: KEY,
      actorUid: "actor-1",
      endpoint: "/api/sac/topup",
      docId: `actor-1_${KEY}`,
      requestHash: requestHash({ amountCents: 5000 }),
    });
  });

  it("propagates the VALIDATION error for a missing key", () => {
    expect(() =>
      buildIdempotencyContext({
        request: reqWith(),
        actorUid: "actor-1",
        endpoint: "/api/sac/topup",
        body: {},
      }),
    ).toThrow(ValidationError);
  });
});
