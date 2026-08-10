import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { APPROVED_BOOTH_ID, SAC_MEMBER_STATE } from "../fixtures";

async function expectNoSeriousViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");

  expect(blocking, blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join("\n")).toEqual([]);
}

test.describe("Accessibility — no serious/critical axe violations", () => {
  test("login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "FraserPay" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("wallet", async ({ page }) => {
    await page.goto("/wallet");
    await expect(page.locator("[data-wallet-balance]")).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("POS", async ({ page }) => {
    await page.goto(`/sell/${APPROVED_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});

test.describe("Accessibility — SAC surfaces", () => {
  test.use({ storageState: SAC_MEMBER_STATE });

  test("feed", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Feed" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("top-up", async ({ page }) => {
    await page.goto("/admin/topup");
    await expect(page.getByRole("button", { name: "Look up student" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("booth detail", async ({ page }) => {
    await page.goto(`/admin/booths/${APPROVED_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("activity", async ({ page }) => {
    await page.goto("/admin/activity");
    await expect(page.getByRole("heading", { name: "Account activity" })).toBeVisible();
    await expectNoSeriousViolations(page);
  });
});
