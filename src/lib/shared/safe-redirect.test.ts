import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("passes through rooted same-origin paths", () => {
    expect(safeRedirectPath("/sell", "/")).toBe("/sell");
    expect(safeRedirectPath("/admin/booths", "/")).toBe("/admin/booths");
    expect(safeRedirectPath("/", "/sell")).toBe("/");
  });

  it("preserves query and hash on same-origin paths", () => {
    expect(safeRedirectPath("/sell?booth=1#top", "/")).toBe("/sell?booth=1#top");
  });

  it("falls back for empty, missing, or non-rooted targets", () => {
    expect(safeRedirectPath(null, "/")).toBe("/");
    expect(safeRedirectPath(undefined, "/sell")).toBe("/sell");
    expect(safeRedirectPath("", "/")).toBe("/");
    expect(safeRedirectPath("evil.com", "/")).toBe("/");
    expect(safeRedirectPath("javascript:alert(1)", "/")).toBe("/");
  });

  it("rejects protocol-relative open redirects", () => {
    expect(safeRedirectPath("//evil.com", "/")).toBe("/");
  });

  it("rejects backslash-prefixed open redirects (the reported bypass)", () => {
    // WHATWG normalizes "\\" to "/" for http(s), so "/\\evil.com" -> https://evil.com/.
    expect(safeRedirectPath("/\\evil.com", "/")).toBe("/");
    expect(safeRedirectPath("/\\/evil.com", "/")).toBe("/");
  });

  it("rejects tab/newline-smuggled protocol-relative targets", () => {
    // The URL parser strips ASCII tab/newline, turning "/\t/evil.com" into "//evil.com".
    expect(safeRedirectPath("/\t/evil.com", "/")).toBe("/");
    expect(safeRedirectPath("/\n/evil.com", "/")).toBe("/");
  });

  it("rejects absolute cross-origin URLs", () => {
    expect(safeRedirectPath("https://evil.com", "/")).toBe("/");
    expect(safeRedirectPath("http://evil.com/path?q=1", "/")).toBe("/");
  });
});
