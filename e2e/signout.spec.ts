import { type Page, expect, test } from "@playwright/test";
import { SESSION_COOKIE_NAME } from "../src/lib/shared/constants";
import { BUYER_UID } from "./fixtures";
import { db, mintSessionCookie } from "./helpers/firebase";

const REGENERATED_CODE = "fp1-Z9Y8X7W6V5U4T3S2R1Q0P";

test.use({ storageState: { cookies: [], origins: [] } });

async function signInAs(page: Page, uid: string): Promise<void> {
  const cookie = await mintSessionCookie(uid);
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: cookie,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

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

function managedCacheKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.startsWith("fraserpay-cache-")),
  );
}

function walletIsCached(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (!name.startsWith("fraserpay-cache-")) continue;
      if (await (await caches.open(name)).match("/wallet")) return true;
    }
    return false;
  });
}

test.describe("Shared-device sign-out privacy", () => {
  test("sign out purges the wallet cache and blocks stale personal HTML", async ({ page }) => {
    await signInAs(page, BUYER_UID);

    await page.goto("/wallet");
    await waitForServiceWorker(page);
    await page.goto("/wallet");
    await expect.poll(() => walletIsCached(page), { timeout: 20_000 }).toBe(true);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");

    expect(await managedCacheKeys(page)).toEqual([]);

    await page.goto("/wallet");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a regenerated payment code appears on the next online wallet open", async ({ page }) => {
    await signInAs(page, BUYER_UID);

    await page.goto("/wallet");
    await waitForServiceWorker(page);
    await page.goto("/wallet");
    await expect.poll(() => walletIsCached(page), { timeout: 20_000 }).toBe(true);

    const before = await page.locator("svg[role='img']").evaluate((el) => el.outerHTML);

    await db().collection("users").doc(BUYER_UID).update({ paymentCode: REGENERATED_CODE });

    await expect(async () => {
      await page.goto("/wallet");
      const after = await page.locator("svg[role='img']").evaluate((el) => el.outerHTML);
      expect(after).not.toBe(before);
    }).toPass({ timeout: 20_000 });
  });
});
