import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AppError,
  BoothNotSellableError,
  CapExceededError,
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  InsufficientFundsError,
  InternalError,
  NotFoundError,
  RateLimitedError,
  SuspendedError,
  toAppError,
  UnauthorizedError,
  ValidationError,
} from "./errors";

const CASES: Array<[new () => AppError, string, number]> = [
  [ValidationError, "VALIDATION", 400],
  [UnauthorizedError, "UNAUTHORIZED", 401],
  [ForbiddenError, "FORBIDDEN", 403],
  [SuspendedError, "SUSPENDED", 403],
  [NotFoundError, "NOT_FOUND", 404],
  [InsufficientFundsError, "INSUFFICIENT_FUNDS", 422],
  [CapExceededError, "CAP_EXCEEDED", 422],
  [BoothNotSellableError, "BOOTH_NOT_SELLABLE", 409],
  [IdempotencyConflictError, "IDEMPOTENCY_CONFLICT", 409],
  [ConflictError, "CONFLICT", 409],
  [RateLimitedError, "RATE_LIMITED", 429],
  [InternalError, "INTERNAL", 500],
];

describe("AppError envelope mapping", () => {
  for (const [Ctor, code, status] of CASES) {
    it(`${Ctor.name} maps to ${code}/${status}`, () => {
      const err = new Ctor();
      expect(err).toBeInstanceOf(AppError);
      expect(err.code).toBe(code);
      expect(err.status).toBe(status);
      const envelope = err.toEnvelope("req-1");
      expect(envelope).toEqual({
        error: { code, message: err.message, requestId: "req-1" },
      });
      expect(envelope.error.message.length).toBeGreaterThan(0);
    });
  }
});

describe("RateLimitedError", () => {
  it("emits a Retry-After header when given a delay", () => {
    expect(new RateLimitedError(30).headers()).toEqual({ "retry-after": "30" });
  });

  it("omits Retry-After when no delay is provided", () => {
    expect(new RateLimitedError().headers()).toBeUndefined();
  });
});

describe("ValidationError.fromZod", () => {
  it("summarizes the first issue with its path", () => {
    const result = z.object({ amountCents: z.number() }).safeParse({ amountCents: "nope" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const err = ValidationError.fromZod(result.error);
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toContain("amountCents");
  });
});

describe("toAppError", () => {
  it("passes AppError instances through unchanged", () => {
    const original = new ForbiddenError("nope");
    expect(toAppError(original)).toBe(original);
  });

  it("maps ZodError to a ValidationError", () => {
    const result = z.string().safeParse(42);
    if (result.success) throw new Error("expected failure");
    expect(toAppError(result.error)).toBeInstanceOf(ValidationError);
  });

  it("maps unknown throwables to InternalError without leaking detail", () => {
    const mapped = toAppError(new Error("secret db dsn leaked here"));
    expect(mapped).toBeInstanceOf(InternalError);
    expect(mapped.message).not.toContain("secret");
  });
});
