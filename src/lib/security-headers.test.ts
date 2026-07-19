import { describe, expect, test } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/security-headers";

function directive(name: string): string | undefined {
  return contentSecurityPolicy
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe("contentSecurityPolicy", () => {
  test("restricts default/script/style/img/connect to self", () => {
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("script-src")).toMatch(/^script-src 'self'/);
    expect(directive("style-src")).toBe("style-src 'self'");
    expect(directive("img-src")).toBe("img-src 'self' data:");
    expect(directive("connect-src")).toBe("connect-src 'self'");
  });

  test("forbids framing and object embedding", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("object-src")).toBe("object-src 'none'");
  });

  test("does not permit third-party origins", () => {
    expect(contentSecurityPolicy).not.toMatch(/https?:\/\//);
  });
});

describe("securityHeaders", () => {
  const globalRule = securityHeaders.find((r) => r.source === "/(.*)");

  function header(key: string): string | undefined {
    return globalRule?.headers.find((h) => h.key === key)?.value;
  }

  test("applies the baseline hardening headers to every path", () => {
    expect(header("Content-Security-Policy")).toBe(contentSecurityPolicy);
    expect(header("Strict-Transport-Security")).toMatch(/max-age=\d+/);
    expect(header("Strict-Transport-Security")).toContain("includeSubDomains");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toContain("camera=(self)");
  });

  test("marks the service worker as non-cacheable", () => {
    const swRule = securityHeaders.find((r) => r.source === "/sw.js");
    expect(swRule?.headers.find((h) => h.key === "Cache-Control")?.value).toMatch(/no-cache/);
  });
});
