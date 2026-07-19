import "server-only";
import { z } from "zod";

export const ERROR_CODES = [
  "VALIDATION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "SUSPENDED",
  "NOT_FOUND",
  "INSUFFICIENT_FUNDS",
  "CAP_EXCEEDED",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "BOOTH_NOT_SELLABLE",
  "CONFLICT",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; requestId: string };
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  headers(): Record<string, string> | undefined {
    return undefined;
  }

  toEnvelope(requestId: string): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, requestId } };
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION" as const;
  readonly status = 400;

  constructor(message = "Invalid request.") {
    super(message);
  }

  static fromZod(error: z.ZodError): ValidationError {
    const first = error.issues[0];
    if (!first) return new ValidationError();
    const path = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
    return new ValidationError(`${path}${first.message}`);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED" as const;
  readonly status = 401;

  constructor(message = "Authentication required.") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN" as const;
  readonly status = 403;

  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

export class SuspendedError extends AppError {
  readonly code = "SUSPENDED" as const;
  readonly status = 403;

  constructor(message = "This account is suspended — see SAC.") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;

  constructor(message = "Not found.") {
    super(message);
  }
}

export class InsufficientFundsError extends AppError {
  readonly code = "INSUFFICIENT_FUNDS" as const;
  readonly status = 422;

  constructor(message = "Balance can't cover this cart.") {
    super(message);
  }
}

export class CapExceededError extends AppError {
  readonly code = "CAP_EXCEEDED" as const;
  readonly status = 422;

  constructor(message = "This exceeds the allowed cap.") {
    super(message);
  }
}

export class BoothNotSellableError extends AppError {
  readonly code = "BOOTH_NOT_SELLABLE" as const;
  readonly status = 409;

  constructor(message = "This booth cannot sell right now.") {
    super(message);
  }
}

export class IdempotencyConflictError extends AppError {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
  readonly status = 409;

  constructor(message = "This request conflicts with a previous one.") {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly status = 409;

  constructor(message = "The request conflicts with the current state.") {
    super(message);
  }
}

export class RateLimitedError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;
  readonly retryAfterSeconds?: number;

  constructor(retryAfterSeconds?: number, message = "Too many requests — slow down.") {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }

  headers(): Record<string, string> | undefined {
    return this.retryAfterSeconds === undefined
      ? undefined
      : { "retry-after": String(this.retryAfterSeconds) };
  }
}

export class InternalError extends AppError {
  readonly code = "INTERNAL" as const;
  readonly status = 500;

  constructor(message = "Something went wrong.") {
    super(message);
  }
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) return ValidationError.fromZod(err);
  return new InternalError();
}
