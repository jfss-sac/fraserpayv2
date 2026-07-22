import { describe, expect, it } from "vitest";
import { JOIN_CODE_ALPHABET, generateJoinCode } from "./boothCode";

const FORMAT = new RegExp(`^[A-Z]{4}-[${JOIN_CODE_ALPHABET}]{3}$`);
const SUFFIX_FORMAT = new RegExp(`^[${JOIN_CODE_ALPHABET}]{3}$`);

describe("generateJoinCode", () => {
  it("emits a NAME4-XYZ shape with a random suffix from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode("Taco Stand");
      expect(code).toMatch(FORMAT);
      expect(code.split("-")[1]).toMatch(SUFFIX_FORMAT);
    }
  });

  it("keeps the random suffix free of the ambiguous characters I, L, O, 0, 1", () => {
    for (let i = 0; i < 200; i++) {
      const suffix = generateJoinCode("Illinois Oolong").split("-")[1]!;
      expect(suffix).not.toMatch(/[ILO01]/);
    }
  });

  it("derives the prefix from the booth name's letters", () => {
    expect(generateJoinCode("Taco Stand").startsWith("TACO-")).toBe(true);
    expect(generateJoinCode("Fries")).toMatch(/^FRIE-/);
  });

  it("pads short names to a 4-character prefix", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateJoinCode("Hi");
      expect(code).toMatch(FORMAT);
      expect(code.startsWith("HI")).toBe(true);
    }
  });

  it("falls back to random letters when the name has none", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateJoinCode("12 !!")).toMatch(FORMAT);
    }
  });

  it("produces mostly-distinct codes across many draws (uniqueness enforced at write time)", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateJoinCode("Taco"));
    expect(codes.size).toBeGreaterThan(950);
  });
});
