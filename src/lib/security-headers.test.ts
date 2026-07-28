import { afterEach, describe, expect, test, vi } from "vitest";
import { buildContentSecurityPolicy, securityHeaders } from "@/lib/security-headers";

const NONCE = "test-nonce-value";

function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy(NONCE);

  test("keeps default/style/img/font self-only", () => {
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "style-src")).toBe("style-src 'self'");
    expect(directive(csp, "img-src")).toBe("img-src 'self' data:");
    expect(directive(csp, "font-src")).toBe("font-src 'self'");
  });

  test("script-src uses the per-request nonce and never 'unsafe-inline'", () => {
    const scriptSrc = directive(csp, "script-src") ?? "";
    expect(scriptSrc).toMatch(/^script-src 'self'/);
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  test("carries no unsafe-* keyword in any directive", () => {
    expect(csp).not.toMatch(/'unsafe-[a-z-]+'/);
  });

  test("connect-src starts from self before any allowance", () => {
    expect(directive(csp, "connect-src")).toMatch(/^connect-src 'self'/);
  });

  test("forbids framing and object embedding", () => {
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
  });

  test("permits only the Firebase Auth origins, and only where sign-in needs them", () => {
    expect(directive(csp, "script-src")).toContain("https://apis.google.com");
    expect(directive(csp, "connect-src")).toContain("https://identitytoolkit.googleapis.com");
    expect(directive(csp, "connect-src")).toContain("https://securetoken.googleapis.com");
    expect(directive(csp, "frame-src")).toBe(
      "frame-src https://apis.google.com https://accounts.google.com https://*.firebaseapp.com",
    );

    const allowed = new Set([
      "https://apis.google.com",
      "https://accounts.google.com",
      "https://*.firebaseapp.com",
      "https://identitytoolkit.googleapis.com",
      "https://securetoken.googleapis.com",
    ]);
    const origins = csp.match(/https:\/\/[^\s;]+/g) ?? [];
    for (const origin of origins) expect(allowed.has(origin)).toBe(true);
  });

  test("never allows localhost/emulator origins outside development", () => {
    expect(csp).not.toContain("127.0.0.1");
    expect(csp).not.toContain("localhost");
  });

  test("upgrades insecure requests in production", () => {
    expect(csp).toContain("upgrade-insecure-requests");
  });
});

describe("buildContentSecurityPolicy in development", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("allows the local emulator + HMR origins so browser sign-in works", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    const dev = await import("@/lib/security-headers");
    const csp = dev.buildContentSecurityPolicy(NONCE);

    const find = (name: string) =>
      csp
        .split(";")
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${name} `));

    const connect = find("connect-src");
    expect(connect).toContain("http://127.0.0.1:9099");
    expect(connect).toContain("http://127.0.0.1:8080");
    expect(connect).toContain("ws://127.0.0.1:3000");
    expect(connect).toContain("https://identitytoolkit.googleapis.com");
    expect(find("frame-src")).toContain("http://127.0.0.1:9099");
    expect(find("script-src")).toContain("'unsafe-eval'");
    expect(find("script-src")).not.toContain("'unsafe-inline'");
    expect(find("style-src")).toContain("'unsafe-inline'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  test("omits HSTS in development so http/ws dev URLs are not force-upgraded", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    const dev = await import("@/lib/security-headers");
    const globalRule = dev.securityHeaders.find((r) => r.source === "/(.*)");
    expect(globalRule?.headers.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });
});

describe("securityHeaders", () => {
  const globalRule = securityHeaders.find((r) => r.source === "/(.*)");

  function header(key: string): string | undefined {
    return globalRule?.headers.find((h) => h.key === key)?.value;
  }

  test("applies the baseline hardening headers to every path", () => {
    expect(header("Strict-Transport-Security")).toMatch(/max-age=\d+/);
    expect(header("Strict-Transport-Security")).toContain("includeSubDomains");
    expect(header("X-Content-Type-Options")).toBe("nosniff");
    expect(header("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(header("Permissions-Policy")).toContain("camera=(self)");
  });

  test("does not set the CSP statically (proxy sets it per request with a nonce)", () => {
    expect(header("Content-Security-Policy")).toBeUndefined();
  });

  test("marks the service worker as non-cacheable", () => {
    const swRule = securityHeaders.find((r) => r.source === "/sw.js");
    expect(swRule?.headers.find((h) => h.key === "Cache-Control")?.value).toMatch(/no-cache/);
  });
});
