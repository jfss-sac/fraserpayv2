import { describe, expect, it } from "vitest";

import {
  BALANCE_CAP_CENTS,
  HIGH_AMOUNT_CENTS,
  RECONFIRM_CENTS,
  TOPUP_CAP_CENTS,
} from "./constants";
import {
  exceedsBalanceCap,
  exceedsTopupCap,
  formatCents,
  isHighAmount,
  isValidAmount,
  pointsFor,
  requiresReconfirm,
} from "./money";

describe("isValidAmount", () => {
  it("accepts positive multiples of 50 cents", () => {
    expect(isValidAmount(50)).toBe(true);
    expect(isValidAmount(100)).toBe(true);
    expect(isValidAmount(199950)).toBe(true);
  });

  it("rejects zero (not > 0)", () => {
    expect(isValidAmount(0)).toBe(false);
  });

  it("rejects negatives even when a multiple of 50 (isolates the > 0 branch)", () => {
    expect(isValidAmount(-50)).toBe(false);
  });

  it("rejects amounts that are not multiples of 50", () => {
    expect(isValidAmount(49)).toBe(false);
    expect(isValidAmount(75)).toBe(false);
  });

  it("rejects non-integers (isolates the Number.isInteger branch)", () => {
    expect(isValidAmount(50.5)).toBe(false);
    expect(isValidAmount(Number.NaN)).toBe(false);
  });
});

describe("pointsFor", () => {
  it("grants 5 points per whole dollar", () => {
    expect(pointsFor(100)).toBe(5);
    expect(pointsFor(1000)).toBe(50);
  });

  it("grants exact half-points for half-dollar top-ups (A2)", () => {
    expect(pointsFor(1050)).toBe(52.5);
    expect(pointsFor(50)).toBe(2.5);
  });

  it("grants zero points for a zero amount", () => {
    expect(pointsFor(0)).toBe(0);
  });
});

describe("formatCents", () => {
  it("formats whole and fractional dollars with two decimal places", () => {
    expect(formatCents(1050)).toBe("$10.50");
    expect(formatCents(500)).toBe("$5.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats negative deltas with a leading minus (ledger reversals)", () => {
    expect(formatCents(-500)).toBe("-$5.00");
    expect(formatCents(-1)).toBe("-$0.01");
  });
});

describe("exceedsTopupCap", () => {
  it("allows exactly the $100 cap", () => {
    expect(exceedsTopupCap(TOPUP_CAP_CENTS)).toBe(false);
    expect(exceedsTopupCap(TOPUP_CAP_CENTS - 50)).toBe(false);
  });

  it("flags amounts over the $100 cap", () => {
    expect(exceedsTopupCap(TOPUP_CAP_CENTS + 50)).toBe(true);
  });
});

describe("exceedsBalanceCap", () => {
  it("allows exactly the $200 resulting-balance cap", () => {
    expect(exceedsBalanceCap(BALANCE_CAP_CENTS)).toBe(false);
    expect(exceedsBalanceCap(BALANCE_CAP_CENTS - 50)).toBe(false);
  });

  it("flags a resulting balance over the $200 cap", () => {
    expect(exceedsBalanceCap(BALANCE_CAP_CENTS + 50)).toBe(true);
  });
});

describe("requiresReconfirm", () => {
  it("does not require re-confirm at or below $50", () => {
    expect(requiresReconfirm(RECONFIRM_CENTS)).toBe(false);
    expect(requiresReconfirm(RECONFIRM_CENTS - 50)).toBe(false);
  });

  it("requires re-confirm above $50", () => {
    expect(requiresReconfirm(RECONFIRM_CENTS + 50)).toBe(true);
  });
});

describe("isHighAmount", () => {
  it("is not high at or below $15.00", () => {
    expect(isHighAmount(HIGH_AMOUNT_CENTS)).toBe(false);
    expect(isHighAmount(HIGH_AMOUNT_CENTS - 50)).toBe(false);
  });

  it("is high strictly above $15.00", () => {
    expect(isHighAmount(HIGH_AMOUNT_CENTS + 50)).toBe(true);
  });
});
