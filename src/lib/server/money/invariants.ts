import "server-only";
import { ConflictError, ForbiddenError, InternalError, NotFoundError } from "../errors";
import type { UserDoc } from "../db";

export function assertNonNegative(value: number): void {
  if (value < 0) throw new InternalError();
}

export function assertNotSelf(actorUid: string, targetUid: string, message: string): void {
  if (actorUid === targetUid) throw new ForbiddenError(message);
}

export function requireUser(data: UserDoc | undefined, message: string): UserDoc {
  if (!data) throw new NotFoundError(message);
  return data;
}

export function assertRefundable(amountCents: number): void {
  if (amountCents <= 0) throw new ConflictError("Nothing left to refund.");
}
