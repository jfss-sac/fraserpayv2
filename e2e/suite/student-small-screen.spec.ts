import { type Page, expect, test } from "@playwright/test";
import { OPERATOR_UID } from "../fixtures";
import { signInAs } from "../helpers/auth";

const AUTHENTICATED_ROUTES = [
  { path: "/wallet", heading: "Wallet" },
  { path: "/account", heading: "Account" },
  { path: "/leaderboard", heading: "Leaderboard" },
  { path: "/booths/join", heading: "Join a booth" },
  { path: "/request-booth", heading: "Request a booth" },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect(
    widths.documentScrollWidth,
    `${page.url()} scrolls wider than ${widths.clientWidth}px`,
  ).toBeLessThanOrEqual(widths.clientWidth);
  expect(widths.bodyScrollWidth, `${page.url()} body overflows horizontally`).toBeLessThanOrEqual(
    widths.clientWidth,
  );
}

test.describe("Student-facing pages at 320 px", () => {
  test("fit the viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.context().clearCookies();

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "FraserPay" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await signInAs(page, OPERATOR_UID);
    for (const route of AUTHENTICATED_ROUTES) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });
});
