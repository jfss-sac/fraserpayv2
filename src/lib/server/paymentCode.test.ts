import { describe, expect, it } from "vitest";
import { generatePaymentCode } from "./paymentCode";

const FORMAT = /^fp1-[0-9A-HJKMNP-TV-Z]{26}$/;

describe("generatePaymentCode", () => {
  it("emits the fp1- prefix and 26 Crockford base32 characters", () => {
    for (let i = 0; i < 100; i++) {
      expect(generatePaymentCode()).toMatch(FORMAT);
    }
  });

  it("never emits the ambiguous Crockford letters I, L, O, U", () => {
    for (let i = 0; i < 100; i++) {
      const body = generatePaymentCode().slice(4);
      expect(body).not.toMatch(/[ILOU]/);
    }
  });

  it("produces distinct codes across many draws", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generatePaymentCode());
    expect(codes.size).toBe(1000);
  });
});
