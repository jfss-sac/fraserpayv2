import { describe, expect, test } from "vitest";
import {
  CACHE_PREFIX,
  PURGE_CACHES_MESSAGE,
  STRATEGY,
  cacheName,
  cachesToPurge,
  isManagedCache,
  isShellRoute,
  isStaleCache,
  isStaticAsset,
  selectStrategy,
} from "./sw-core.mjs";

function nav(pathname: string, over: Record<string, unknown> = {}) {
  return { method: "GET", sameOrigin: true, pathname, isNavigate: true, ...over };
}

describe("selectStrategy", () => {
  test("never caches API routes", () => {
    expect(selectStrategy(nav("/api/wallet", { isNavigate: false }))).toBe(STRATEGY.NEVER_CACHE);
    expect(selectStrategy(nav("/api/booth/charge", { isNavigate: false }))).toBe(
      STRATEGY.NEVER_CACHE,
    );
    expect(selectStrategy(nav("/api", { isNavigate: false }))).toBe(STRATEGY.NEVER_CACHE);
  });

  test("serves _next/static and public assets cache-first", () => {
    for (const pathname of [
      "/_next/static/chunks/main-abc123.js",
      "/_next/static/css/app.css",
      "/icons/icon-192.png",
      "/manifest.webmanifest",
      "/favicon.ico",
    ]) {
      expect(selectStrategy(nav(pathname, { isNavigate: false }))).toBe(
        STRATEGY.STATIC_CACHE_FIRST,
      );
    }
  });

  test("serves shell-route navigations html-cache-first", () => {
    expect(selectStrategy(nav("/wallet"))).toBe(STRATEGY.HTML_CACHE_FIRST);
    expect(selectStrategy(nav("/sell"))).toBe(STRATEGY.HTML_CACHE_FIRST);
    expect(selectStrategy(nav("/sell/booth-1"))).toBe(STRATEGY.HTML_CACHE_FIRST);
  });

  test("does not cache shell HTML fetched as a non-navigation (e.g. RSC prefetch)", () => {
    expect(selectStrategy(nav("/wallet", { isNavigate: false }))).toBe(STRATEGY.PASSTHROUGH);
  });

  test("passes through non-shell navigations, other origins, and non-GET methods", () => {
    expect(selectStrategy(nav("/login"))).toBe(STRATEGY.PASSTHROUGH);
    expect(selectStrategy(nav("/admin"))).toBe(STRATEGY.PASSTHROUGH);
    expect(selectStrategy(nav("/wallet", { sameOrigin: false }))).toBe(STRATEGY.PASSTHROUGH);
    expect(selectStrategy(nav("/wallet", { method: "POST" }))).toBe(STRATEGY.PASSTHROUGH);
    expect(selectStrategy(nav("/", { method: "HEAD" }))).toBe(STRATEGY.PASSTHROUGH);
  });

  test("API classification wins over any accidental static/shell match", () => {
    expect(selectStrategy(nav("/api/icons/x", { isNavigate: false }))).toBe(STRATEGY.NEVER_CACHE);
  });
});

describe("isShellRoute", () => {
  test("matches shell roots and their subpaths only", () => {
    expect(isShellRoute("/wallet")).toBe(true);
    expect(isShellRoute("/sell")).toBe(true);
    expect(isShellRoute("/sell/abc")).toBe(true);
    expect(isShellRoute("/wallets")).toBe(false);
    expect(isShellRoute("/selloff")).toBe(false);
    expect(isShellRoute("/")).toBe(false);
  });
});

describe("isStaticAsset", () => {
  test("distinguishes cacheable static assets from app routes", () => {
    expect(isStaticAsset("/_next/static/x.js")).toBe(true);
    expect(isStaticAsset("/icons/icon-512.png")).toBe(true);
    expect(isStaticAsset("/manifest.webmanifest")).toBe(true);
    expect(isStaticAsset("/favicon.ico")).toBe(true);
    expect(isStaticAsset("/wallet")).toBe(false);
    expect(isStaticAsset("/_next/data/x.json")).toBe(false);
  });
});

describe("cache-name math", () => {
  test("embeds the build version behind the managed prefix", () => {
    expect(cacheName("v1")).toBe(`${CACHE_PREFIX}-v1`);
    expect(isManagedCache(cacheName("abc"))).toBe(true);
    expect(isManagedCache("workbox-precache")).toBe(false);
    expect(isManagedCache("some-other-cache")).toBe(false);
  });

  test("marks only managed caches from a different version as stale", () => {
    expect(isStaleCache(cacheName("old"), "new")).toBe(true);
    expect(isStaleCache(cacheName("same"), "same")).toBe(false);
    expect(isStaleCache("unmanaged-cache", "new")).toBe(false);
  });
});

describe("sign-out purge", () => {
  test("selects every managed cache regardless of version, sparing foreign caches", () => {
    const names = [cacheName("v1"), cacheName("v2"), "workbox-precache", "some-other-cache"];
    expect(cachesToPurge(names)).toEqual([cacheName("v1"), cacheName("v2")]);
  });

  test("purges nothing when no managed caches are present", () => {
    expect(cachesToPurge(["workbox-precache", "images"])).toEqual([]);
  });

  test("exposes a stable message-type contract for the sign-out belt", () => {
    expect(PURGE_CACHES_MESSAGE).toBe("fraserpay/purge-caches");
  });
});
