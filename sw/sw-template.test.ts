import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, test, vi } from "vitest";

const core = readFileSync(join(process.cwd(), "sw/sw-core.mjs"), "utf8")
  .replace(/^export\s+(const|function|class|let|var)\s/gm, "$1 ")
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, "")
  .trim();
const template = readFileSync(join(process.cwd(), "sw/sw.template.js"), "utf8");

interface FetchEventLike {
  request: { method: string; mode: string; url: string };
  respondWith(response: Promise<unknown>): void;
  waitUntil(work: Promise<unknown>): void;
}

function serviceWorkerHarness(cached: object, fresh: object) {
  const listeners = new Map<string, (event: FetchEventLike) => void>();
  const cache = {
    add: vi.fn(async () => undefined),
    match: vi.fn(async () => cached),
    put: vi.fn(async () => undefined),
  };
  const fetch = vi.fn(async () => fresh);
  const self = {
    addEventListener: vi.fn((type: string, listener: (event: FetchEventLike) => void) => {
      listeners.set(type, listener);
    }),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: "https://fraserpay.test" },
    navigator: { onLine: true },
    skipWaiting: vi.fn(async () => undefined),
  };
  const caches = {
    delete: vi.fn(async () => true),
    keys: vi.fn(async () => []),
    open: vi.fn(async () => cache),
  };

  runInNewContext(`const SW_VERSION = "test"; const PRECACHE_URLS = [];\n${core}\n${template}`, {
    URL,
    caches,
    fetch,
    self,
  });

  return { cache, fetch, listener: listeners.get("fetch")! };
}

describe("service worker mutable public assets", () => {
  test.each(["/icons/icon-192.png", "/manifest.webmanifest"])(
    "serves cached %s immediately and refreshes it in the background",
    async (pathname) => {
      const cached = { source: "cache" };
      const clone = { source: "network-clone" };
      const fresh = { clone: () => clone, ok: true, redirected: false };
      const { cache, fetch, listener } = serviceWorkerHarness(cached, fresh);
      const request = {
        method: "GET",
        mode: "no-cors",
        url: `https://fraserpay.test${pathname}`,
      };
      const background: Promise<unknown>[] = [];
      let response: Promise<unknown> | undefined;

      listener({
        request,
        respondWith(value) {
          response = value;
        },
        waitUntil(work) {
          background.push(work);
        },
      });

      expect(await response).toBe(cached);
      expect(fetch).toHaveBeenCalledWith(request);
      await Promise.all(background);
      expect(cache.put).toHaveBeenCalledWith(request, clone);
    },
  );
});
