import { describe, expect, it } from "vitest";

import { centsToWords, integerToWords } from "./number-to-words";

describe("integerToWords", () => {
  it("spells out zero and single digits", () => {
    expect(integerToWords(0)).toBe("zero");
    expect(integerToWords(1)).toBe("one");
    expect(integerToWords(9)).toBe("nine");
  });

  it("spells out the teens without hyphens", () => {
    expect(integerToWords(11)).toBe("eleven");
    expect(integerToWords(19)).toBe("nineteen");
  });

  it("hyphenates compound tens and keeps round tens plain", () => {
    expect(integerToWords(20)).toBe("twenty");
    expect(integerToWords(52)).toBe("fifty-two");
    expect(integerToWords(99)).toBe("ninety-nine");
  });

  it("spells out hundreds and thousands", () => {
    expect(integerToWords(100)).toBe("one hundred");
    expect(integerToWords(305)).toBe("three hundred five");
    expect(integerToWords(1234)).toBe("one thousand two hundred thirty-four");
    expect(integerToWords(1000000)).toBe("one million");
  });

  it("rejects negatives and non-integers", () => {
    expect(() => integerToWords(-1)).toThrow(RangeError);
    expect(() => integerToWords(1.5)).toThrow(RangeError);
  });
});

describe("centsToWords", () => {
  it("spells out the PRD example exactly", () => {
    expect(centsToWords(5250)).toBe("fifty-two dollars and fifty cents");
  });

  it("omits the cents clause for whole-dollar amounts", () => {
    expect(centsToWords(5000)).toBe("fifty dollars");
    expect(centsToWords(10000)).toBe("one hundred dollars");
  });

  it("uses singular units for one dollar and one cent", () => {
    expect(centsToWords(100)).toBe("one dollar");
    expect(centsToWords(101)).toBe("one dollar and one cent");
    expect(centsToWords(150)).toBe("one dollar and fifty cents");
  });

  it("spells out a cents-only amount", () => {
    expect(centsToWords(50)).toBe("fifty cents");
    expect(centsToWords(1)).toBe("one cent");
  });

  it("returns zero dollars for a zero amount", () => {
    expect(centsToWords(0)).toBe("zero dollars");
  });

  it("handles amounts above the caps (exec override territory)", () => {
    expect(centsToWords(10050)).toBe("one hundred dollars and fifty cents");
    expect(centsToWords(123456)).toBe(
      "one thousand two hundred thirty-four dollars and fifty-six cents",
    );
  });

  it("rejects negatives and non-integers", () => {
    expect(() => centsToWords(-50)).toThrow(RangeError);
    expect(() => centsToWords(50.5)).toThrow(RangeError);
  });
});
