import { describe, expect, it } from "vitest";

import {
  BALANCE_CAP_CENTS,
  CENT_STEP,
  HIGH_AMOUNT_CENTS,
  POINTS_PER_DOLLAR,
  RECONFIRM_CENTS,
  SESSION_TTL_MS,
  TIMEZONE,
  TOPUP_CAP_CENTS,
} from "./constants";

describe("shared constants", () => {
  it("encodes the documented money rules (architecture §3.4, FR-5/8/9/10a)", () => {
    expect(CENT_STEP).toBe(50);
    expect(TOPUP_CAP_CENTS).toBe(10_000);
    expect(BALANCE_CAP_CENTS).toBe(20_000);
    expect(HIGH_AMOUNT_CENTS).toBe(1_500);
    expect(POINTS_PER_DOLLAR).toBe(5);
    expect(RECONFIRM_CENTS).toBe(5_000);
  });

  it("sets a 7-day session TTL in milliseconds (architecture §D2)", () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(SESSION_TTL_MS).toBe(604_800_000);
  });

  it("uses the event-day timezone (A11)", () => {
    expect(TIMEZONE).toBe("America/Toronto");
  });
});
