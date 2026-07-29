import { type Page, expect } from "@playwright/test";

export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      if (!("serviceWorker" in navigator)) return false;
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller !== null;
    },
    null,
    { timeout: 20_000 },
  );
}

export function isCached(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (url) => {
    for (const name of await caches.keys()) {
      if (!name.startsWith("fraserpay-cache-")) continue;
      if (await (await caches.open(name)).match(url)) return true;
    }
    return false;
  }, path);
}

export function managedCacheKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.startsWith("fraserpay-cache-")),
  );
}

export async function warmShell(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForServiceWorker(page);
  await page.goto(path);
  await expect.poll(() => isCached(page, path), { timeout: 20_000 }).toBe(true);
}
