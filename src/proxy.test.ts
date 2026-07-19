import { unstable_doesMiddlewareMatch, getRedirectUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";
import { SESSION_COOKIE_NAME } from "@/lib/shared/constants";

const ORIGIN = "http://localhost:3000";

function matches(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher", () => {
  const guarded = ["/", "/wallet", "/leaderboard", "/sell", "/admin", "/booths/register"];
  for (const path of guarded) {
    it(`runs on app page ${path}`, () => {
      expect(matches(path)).toBe(true);
    });
  }

  const excluded = [
    "/api/auth/session",
    "/login",
    "/sw.js",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/_next/static/chunk.js",
    "/_next/image",
  ];
  for (const path of excluded) {
    it(`skips ${path}`, () => {
      expect(matches(path)).toBe(false);
    });
  }
});

describe("proxy redirect", () => {
  it("redirects a cookieless page request to /login with a next param", () => {
    const res = proxy(new NextRequest(`${ORIGIN}/wallet`));
    expect(res.status).toBe(307);
    const location = getRedirectUrl(res);
    expect(location).not.toBeNull();
    const url = new URL(location as string);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/wallet");
  });

  it("preserves the query string in the next param", () => {
    const res = proxy(new NextRequest(`${ORIGIN}/sell/booth-1?tab=cart`));
    const url = new URL(getRedirectUrl(res) as string);
    expect(url.searchParams.get("next")).toBe("/sell/booth-1?tab=cart");
  });

  it("passes through when the session cookie is present", () => {
    const request = new NextRequest(`${ORIGIN}/wallet`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=abc123` },
    });
    const res = proxy(request);
    expect(getRedirectUrl(res)).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  });
});
