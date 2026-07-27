import { expect, test } from "@playwright/test";
import {
  APPROVED_BOOTH_ID,
  PENDING_BOOTH_ID,
  PENDING_BOOTH_SUBMITTER,
  SAC_EXEC_STATE,
  SAC_MEMBER_STATE,
} from "./fixtures";

const CODE = /^[A-Z]{3,6}-[A-Z0-9]{3}$/;

test.describe("exec booth management", () => {
  test.use({ storageState: SAC_EXEC_STATE });

  test("approving a pending booth surfaces the submitter email and a join code", async ({
    page,
  }) => {
    await page.goto(`/admin/booths/${PENDING_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Taco Stand" })).toBeVisible();
    await expect(page.getByText(PENDING_BOOTH_SUBMITTER)).toBeVisible();

    await page.getByRole("button", { name: "Approve booth" }).click();

    await expect(page.getByText("Booth approved — join code ready.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Join code" })).toBeVisible();
    await expect(page.getByText(/^TACO-[A-Z0-9]{3}$/)).toBeVisible();
  });

  test("rotating a join code replaces the displayed code", async ({ page }) => {
    await page.goto(`/admin/booths/${APPROVED_BOOTH_ID}`);
    await expect(page.getByText("PIZZA-9K1")).toBeVisible();

    await page.getByRole("button", { name: "Rotate code" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Rotate code" }).click();

    await expect(page.getByText("Join code rotated.")).toBeVisible();
    await expect(page.getByText("PIZZA-9K1")).toHaveCount(0);
    await expect(page.getByText(CODE)).toBeVisible();
  });
});

test.describe("member booth view", () => {
  test.use({ storageState: SAC_MEMBER_STATE });

  test("a SAC member sees the booth read-only with no exec controls", async ({ page }) => {
    await page.goto(`/admin/booths/${APPROVED_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Join code" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Rotate code" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save prices" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
    await expect(page.getByLabel("Slice price in dollars")).toHaveCount(0);
  });
});
