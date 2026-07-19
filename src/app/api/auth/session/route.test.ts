import { describe, expect, it } from "vitest";
import { studentNumberFromEmail } from "./route";

describe("studentNumberFromEmail", () => {
  it.each([
    ["843901@pdsb.net", "843901"],
    ["jsmith@pdsb.net", null],
    ["123a45@pdsb.net", null],
    ["@pdsb.net", null],
  ])("maps %s to %s", (email, expected) => {
    expect(studentNumberFromEmail(email)).toBe(expected);
  });
});
