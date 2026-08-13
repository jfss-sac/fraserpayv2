import { expect, test } from "@playwright/test";
import { BUYER_UID, OPERATOR_UID } from "../fixtures";
import { SIGNED_OUT_STATE, provisionViaSignIn, signInAs } from "../helpers/auth";
import { db } from "../helpers/firebase";
import {
  cachedBodyContains,
  isCached,
  managedCacheKeys,
  warmShell,
  waitForServiceWorker,
} from "../helpers/sw";

const REGENERATED_CODE = "fp1-Z9Y8X7W6V5T4S3R2Q1P0NMKJHG";

test.describe("J1 · onboarding → wallet → offline reopen", () => {
  test.describe("first sign-in provisioning", () => {
    test.use({ storageState: SIGNED_OUT_STATE });

    const NEWCOMER = {
      uid: "e2e-j1-newcomer",
      email: "849001@pdsb.net",
      displayName: "Nadia Newcomer",
    };

    test("a first Google sign-in provisions a zero-balance wallet with a payment code", async ({
      page,
    }) => {
      await provisionViaSignIn(page, NEWCOMER);

      await page.goto("/wallet");
      await expect(page.locator("svg[role='img']")).toBeVisible();
      await expect(page.locator("[data-wallet-balance]")).toHaveText("$0.00");

      const snap = await db().collection("users").doc(NEWCOMER.uid).get();
      expect(snap.exists).toBe(true);
      expect(snap.data()?.paymentCode).toBeTruthy();
      expect(snap.data()?.studentNumber).toBe("849001");
    });
  });

  test.describe("wallet refresh & staleness", () => {
    test("renders the QR and balance from server HTML", async ({ page }) => {
      await page.route("**/api/wallet", (route) => route.abort());
      await page.goto("/wallet");
      await expect(page.locator("svg[role='img']")).toBeVisible();
      await expect(page.locator("[data-wallet-balance]")).not.toHaveText("");
    });

    test("online open refreshes the balance and keeps the stamp fresh", async ({ page }) => {
      await page.route("**/api/wallet", async (route) => {
        const response = await route.fetch();
        const dto = await response.json();
        dto.balanceCents = 987654;
        dto.asOf = "2026-07-24T18:30:00.000Z";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(dto),
        });
      });

      await page.goto("/wallet");

      await expect(page.locator("[data-wallet-balance]")).toHaveText("$9876.54");
      await expect(page.locator("[data-wallet-stamp]")).toHaveAttribute("data-stale", "false");
      await expect(page.locator("[data-wallet-asof]")).toHaveText(/Jul 24/);
    });

    test("a failed refresh marks the stamp stale and preserves cached values", async ({ page }) => {
      await page.goto("/wallet");
      const cachedBalance = await page.locator("[data-wallet-balance]").textContent();

      await page.route("**/api/wallet", (route) => route.abort());
      await page.reload();

      await expect(page.locator("[data-wallet-stamp]")).toHaveAttribute("data-stale", "true");
      await expect(page.getByText("may be out of date")).toBeVisible();
      await expect(page.locator("[data-wallet-balance]")).toHaveText(cachedBalance ?? "");
    });

    test("serves a strict nonce-based CSP with no unsafe-inline", async ({ page }) => {
      const response = await page.goto("/wallet");
      const csp = response?.headers()["content-security-policy"] ?? "";
      expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
      expect(csp).not.toContain("unsafe-inline");
    });
  });

  test.describe("offline reopen (NFR-1)", () => {
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
  });

  test.describe("shared-device privacy", () => {
    test.use({ storageState: SIGNED_OUT_STATE });

    test("sign out purges the wallet cache and blocks stale personal HTML", async ({ page }) => {
      await signInAs(page, BUYER_UID);

      await page.goto("/wallet");
      await waitForServiceWorker(page);
      await page.goto("/wallet");
      await expect.poll(() => isCached(page, "/wallet"), { timeout: 20_000 }).toBe(true);

      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL("**/login");

      expect(await managedCacheKeys(page)).toEqual([]);

      await page.goto("/wallet");
      await expect(page).toHaveURL(/\/login/);
    });

    test("the next student to sign in never receives the previous one's payment code", async ({
      page,
    }) => {
      await signInAs(page, BUYER_UID);
      await warmShell(page, "/wallet");
      const buyerCode = await page.locator("code").innerText();

      await page.context().clearCookies();
      await page.goto("/login");
      await expect.poll(() => managedCacheKeys(page), { timeout: 20_000 }).toEqual([]);

      await signInAs(page, OPERATOR_UID);
      await page.goto("/wallet");

      const operatorCode = (await db().collection("users").doc(OPERATOR_UID).get()).data()
        ?.paymentCode as string;
      expect(operatorCode).not.toBe(buyerCode);
      await expect(page.locator("code")).toHaveText(operatorCode);
    });

    test("an ended session's cached wallet is evicted rather than served again", async ({
      page,
    }) => {
      await signInAs(page, BUYER_UID);
      await warmShell(page, "/wallet");

      await page.context().clearCookies();
      await page.goto("/wallet");
      await expect.poll(() => isCached(page, "/wallet"), { timeout: 20_000 }).toBe(false);

      await page.goto("/wallet");
      await expect(page).toHaveURL(/\/login/);
    });

    test("a regenerated payment code appears on the reload after the next online open", async ({
      page,
    }) => {
      await signInAs(page, BUYER_UID);
      await warmShell(page, "/wallet");
      const before = await page.locator("code").innerText();

      await db().collection("users").doc(BUYER_UID).update({ paymentCode: REGENERATED_CODE });

      await page.goto("/wallet");
      await expect(page.locator("code")).toHaveText(before);
      await expect
        .poll(() => cachedBodyContains(page, "/wallet", REGENERATED_CODE), { timeout: 20_000 })
        .toBe(true);

      await page.goto("/wallet");
      await expect(page.locator("code")).toHaveText(REGENERATED_CODE);
    });
  });
});
