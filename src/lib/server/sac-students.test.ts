import { describe, expect, it } from "vitest";
import { searchMode } from "./sac-students";

describe("searchMode (arch §10 students query routing)", () => {
  it("routes anything containing @ to an exact email match", () => {
    expect(searchMode("a@pdsb.net")).toBe("email");
    expect(searchMode("123@pdsb.net")).toBe("email");
  });

  it("routes an all-digit query to an exact student-number match", () => {
    expect(searchMode("8300001")).toBe("studentNumber");
    expect(searchMode("0")).toBe("studentNumber");
  });

  it("routes everything else to a name prefix", () => {
    expect(searchMode("Quokka")).toBe("name");
    expect(searchMode("mary jane")).toBe("name");
    expect(searchMode("8300001a")).toBe("name");
  });
});
