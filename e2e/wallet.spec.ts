import { expect, test } from "@playwright/test";

test.describe("Wallet refresh & staleness", () => {
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
