import { describe, expect, it } from "vitest";
import type { UserDoc } from "../db";
import { ConflictError, InternalError, NotFoundError } from "../errors";
import { assertNonNegative, assertRefundable, requireUser } from "./invariants";

describe("money invariants", () => {
  it("assertNonNegative accepts zero and positive, rejects negative", () => {
    expect(() => assertNonNegative(0)).not.toThrow();
    expect(() => assertNonNegative(500)).not.toThrow();
    expect(() => assertNonNegative(-1)).toThrow(InternalError);
  });

  it("requireUser returns present data and throws NOT_FOUND when absent", () => {
    const user = { displayName: "A" } as UserDoc;
    expect(requireUser(user, "missing")).toBe(user);
    expect(() => requireUser(undefined, "missing")).toThrow(NotFoundError);
  });

  it("assertRefundable rejects non-positive amounts", () => {
    expect(() => assertRefundable(50)).not.toThrow();
    expect(() => assertRefundable(0)).toThrow(ConflictError);
    expect(() => assertRefundable(-50)).toThrow(ConflictError);
  });
});
