import { type Page, expect, test } from "@playwright/test";
import {
  APPROVED_BOOTH_ID,
  BUYER_NAME,
  BUYER_STUDENT_NUMBER,
  DEACTIVATED_BOOTH_ID,
} from "./fixtures";
import { db } from "./helpers/firebase";

async function addItem(page: Page, name: string, times = 1): Promise<void> {
  const add = page.getByRole("button", { name: `Add ${name}` });
  for (let i = 0; i < times; i++) await add.click();
}

async function identifyByStudentNumber(page: Page, studentNumber: string): Promise<void> {
  for (const digit of studentNumber) {
    await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
  }
  await page.getByRole("button", { name: "Look up student" }).click();
}

test.describe("Booth POS journey", () => {
  test("build cart with custom ×N, identify by number pad, sufficiency, charge succeeds", async ({
    page,
  }) => {
    await page.goto(`/sell/${APPROVED_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();

    await addItem(page, "Slice");
    await addItem(page, "Custom", 3);
    await expect(page.getByLabel("Cart total")).toHaveText("$4.50");

    await identifyByStudentNumber(page, BUYER_STUDENT_NUMBER);
    await expect(page.getByText(`Is this ${BUYER_NAME}?`)).toBeVisible();
    await expect(page.getByText("Ask for their student card to confirm.")).toBeVisible();
    await expect(page.getByText("Funds available")).toBeVisible();

    await page.getByRole("button", { name: "Charge" }).click();

    await expect(page.getByText(`Charged $4.50 to ${BUYER_NAME}`)).toBeVisible();
    await expect(page.getByLabel("Cart total")).toHaveText("$0.00");
  });

  test("insufficient funds is rejected cleanly with the cart preserved", async ({ page }) => {
    await page.goto(`/sell/${APPROVED_BOOTH_ID}`);

    await addItem(page, "Whole Pie", 2);
    await expect(page.getByLabel("Cart total")).toHaveText("$30.00");

    await identifyByStudentNumber(page, BUYER_STUDENT_NUMBER);
    await expect(page.getByText("Not enough funds")).toBeVisible();

    await page.getByRole("button", { name: "Charge" }).click();

    await expect(page.getByText("Balance can't cover this cart.")).toBeVisible();
    await expect(page.getByLabel("Cart total")).toHaveText("$30.00");
  });

  test("a deactivated booth cannot sell", async ({ page }) => {
    await page.goto(`/sell/${DEACTIVATED_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Candy Corner" })).toBeVisible();
    await expect(page.getByText(/can.t sell yet/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Charge" })).toHaveCount(0);
  });

  test("a timed-out charge retried with the same key produces exactly one ledger entry", async ({
    page,
  }) => {
    const idempotencyKeys: string[] = [];

    await page.route("**/api/booth/charge", async (route) => {
      idempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (idempotencyKeys.length === 1) {
        await route.fetch();
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    await page.goto(`/sell/${APPROVED_BOOTH_ID}`);
    await addItem(page, "Slice");
    await expect(page.getByLabel("Cart total")).toHaveText("$3.00");

    await identifyByStudentNumber(page, BUYER_STUDENT_NUMBER);
    await expect(page.getByText("Funds available")).toBeVisible();

    await page.getByRole("button", { name: "Charge" }).click();
    await expect(page.getByText(`Charged $3.00 to ${BUYER_NAME}`)).toBeVisible();

    expect(idempotencyKeys.length).toBe(2);
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1]);
    expect(idempotencyKeys[0]).not.toBe("");

    const entries = await db()
      .collection("ledger")
      .where("idempotencyKey", "==", idempotencyKeys[0])
      .get();
    expect(entries.size).toBe(1);
  });

  test("offline banner blocks charging and the cart survives reconnect", async ({ page }) => {
    await page.goto(`/sell/${APPROVED_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.getByText("You're offline")).toBeVisible();

    await addItem(page, "Slice", 2);
    await expect(page.getByLabel("Cart total")).toHaveText("$6.00");
    await expect(page.getByRole("button", { name: "Charge" })).toBeDisabled();

    await page.context().setOffline(false);
    await expect(page.getByText("You're offline")).toBeHidden();
    await expect(page.getByLabel("Cart total")).toHaveText("$6.00");
  });
});
