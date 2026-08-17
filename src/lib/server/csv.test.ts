import { describe, expect, it } from "vitest";
import { csvDocument, csvLine, escapeCsvCell } from "./csv";

describe("CSV serialization", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvLine(["a,b", 'a"b', "a\nb"])).toBe('"a,b","a""b","a\nb"\r\n');
  });

  it("neutralizes formula-like string cells", () => {
    expect(csvDocument([["=SUM(A1)", "+1", "-1", "@name"]])).toBe(
      '"\'=SUM(A1)","\'+1","\'-1","\'@name"\r\n',
    );
  });

  it("keeps numeric values numeric while escaping text values", () => {
    expect(escapeCsvCell(-100)).toBe('"-100"');
    expect(escapeCsvCell("-100")).toBe('"\'-100"');
  });
});
