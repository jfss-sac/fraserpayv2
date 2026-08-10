import { describe, expect, test } from "vitest";
import { FALLBACK_ORIGIN, canonicalPath, resolveOrigin, serializeJsonLd } from "./site";

describe("resolveOrigin", () => {
  test("prefers the configured site URL and strips path and trailing slash", () => {
    expect(resolveOrigin("https://pay.example.ca/", null, null, null)).toBe(
      "https://pay.example.ca",
    );
    expect(resolveOrigin("https://pay.example.ca/sub/path", null, null, null)).toBe(
      "https://pay.example.ca",
    );
  });

  test("falls back when the configured site URL is not a URL", () => {
    expect(resolveOrigin("not a url", "pay.example.ca", null, null)).toBe(FALLBACK_ORIGIN);
  });

  test("derives https from the forwarded host when nothing is configured", () => {
    expect(resolveOrigin(undefined, "pay.example.ca", "internal:3000", null)).toBe(
      "https://pay.example.ca",
    );
  });

  test("honours x-forwarded-proto and takes the first hop of a comma list", () => {
    expect(resolveOrigin(undefined, "a.example.ca, b.example.ca", null, "http, https")).toBe(
      "http://a.example.ca",
    );
  });

  test("uses http for loopback hosts", () => {
    expect(resolveOrigin(undefined, null, "127.0.0.1:3000", null)).toBe("http://127.0.0.1:3000");
    expect(resolveOrigin(undefined, null, "localhost:3000", null)).toBe("http://localhost:3000");
  });

  test.each([
    'evil.example.ca/"></script><script>alert(1)</script>',
    "evil.example.ca<script>",
    "javascript:alert(1)",
    "pay.example.ca/path",
    "pay example ca",
    "",
  ])("rejects an unsafe host: %j", (host) => {
    expect(resolveOrigin(undefined, null, host, "https")).toBe(FALLBACK_ORIGIN);
  });

  test("rejects a non-http forwarded proto rather than echoing it", () => {
    expect(resolveOrigin(undefined, null, "pay.example.ca", "javascript")).toBe(
      "https://pay.example.ca",
    );
  });
});

describe("canonicalPath", () => {
  test("keeps a normal path and drops a trailing slash", () => {
    expect(canonicalPath("/wallet")).toBe("/wallet");
    expect(canonicalPath("/admin/booths/")).toBe("/admin/booths");
  });

  test("keeps the root as a single slash", () => {
    expect(canonicalPath("/")).toBe("/");
  });

  test("falls back to the root for a missing or non-absolute path", () => {
    expect(canonicalPath(null)).toBe("/");
    expect(canonicalPath("wallet")).toBe("/");
    expect(canonicalPath("https://evil.example.ca")).toBe("/");
  });
});

describe("serializeJsonLd", () => {
  test("escapes < so a payload cannot close the surrounding script element", () => {
    const json = serializeJsonLd({ url: 'https://x/"></script><script>alert(1)</script>' });
    expect(json).not.toContain("</script>");
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual({ url: 'https://x/"></script><script>alert(1)</script>' });
  });
});
