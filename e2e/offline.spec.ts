import { type Page, expect, test } from "@playwright/test";
import { APPROVED_BOOTH_ID } from "./fixtures";

async function waitForServiceWorker(page: Page): Promise<void> {
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

function isCached(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (url) => {
    for (const name of await caches.keys()) {
      if (!name.startsWith("fraserpay-cache-")) continue;
      if (await (await caches.open(name)).match(url)) return true;
    }
    return false;
  }, path);
}

async function warmShell(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await waitForServiceWorker(page);
  await page.goto(path);
  await expect.poll(() => isCached(page, path), { timeout: 20_000 }).toBe(true);
}

test.describe("Offline shells (NFR-1)", () => {
  test("wallet reopens offline with QR, cached balance, stale stamp, and no failed requests", async ({
    page,
  }) => {
    await warmShell(page, "/wallet");
    const cachedBalance = await page.locator("[data-wallet-balance]").textContent();

    await page.context().setOffline(true);

    const failures: string[] = [];
    page.on("requestfailed", (request) => {
      if (!request.url().includes("_rsc=")) failures.push(request.url());
    });

    await page.goto("/wallet");

    await expect(page.locator("svg[role='img']")).toBeVisible();
    await expect(page.locator("[data-wallet-balance]")).toHaveText(cachedBalance ?? "");
    await expect(page.locator("[data-wallet-stamp]")).toHaveAttribute("data-stale", "true");
    await expect(page.getByText("may be out of date")).toBeVisible();

    expect(failures, `unexpected failed requests: ${failures.join(", ")}`).toEqual([]);
  });

  test("POS shell opens offline with the offline banner", async ({ page }) => {
    const path = `/sell/${APPROVED_BOOTH_ID}`;
    await warmShell(page, path);

    await page.context().setOffline(true);
    await page.goto(path);

    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();
    await expect(page.getByText("You're offline")).toBeVisible();
  });
});
