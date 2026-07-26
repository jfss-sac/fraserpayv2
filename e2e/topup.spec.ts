import { type Page, expect, test } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { SAC_EXEC_STATE, SAC_MEMBER_STATE } from "./fixtures";
import { db } from "./helpers/firebase";

const HAPPY = { uid: "e2e-topup-happy", number: "870001", name: "Tilly Topup" };
const RECONFIRM = { uid: "e2e-topup-reconfirm", number: "870002", name: "Ronan Reconfirm" };
const NEARCAP = { uid: "e2e-topup-nearcap", number: "870003", name: "Cappy Nearcap" };

async function makeBuyer(
  buyer: { uid: string; number: string; name: string },
  balanceCents: number,
): Promise<void> {
  await db()
    .collection("users")
    .doc(buyer.uid)
    .set({
      email: `${buyer.number}@pdsb.net`,
      displayName: buyer.name,
      displayNameLower: buyer.name.toLowerCase(),
      studentNumber: buyer.number,
      paymentCode: `fp1-${buyer.uid}`,
      balanceCents,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function identify(page: Page, studentNumber: string): Promise<void> {
  await page.goto("/admin/topup");
  for (const digit of studentNumber) {
    await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
  }
  await page.getByRole("button", { name: "Look up student" }).click();
}

test.beforeAll(async () => {
  await makeBuyer(HAPPY, 500);
  await makeBuyer(RECONFIRM, 0);
  await makeBuyer(NEARCAP, 19_900);
});

test.describe("SAC member top-up", () => {
  test.use({ storageState: SAC_MEMBER_STATE });

  test("happy path: identify, confirm name, enter amount, success shows balance + points", async ({
    page,
  }) => {
    await identify(page, HAPPY.number);

    await expect(page.getByText(`Is this ${HAPPY.name}?`)).toBeVisible();
    await page.getByRole("button", { name: "Yes, top up" }).click();

    await expect(page.getByText(`Topping up ${HAPPY.name}`)).toBeVisible();
    await page.getByRole("button", { name: "$10.00", exact: true }).click();
    await page.getByRole("button", { name: "Top up $10.00" }).click();

    await expect(page.getByText(`Topped up ${HAPPY.name}`)).toBeVisible();
    await expect(page.getByText("$10.00")).toBeVisible();
    await expect(page.getByText("$15.00")).toBeVisible();
    await expect(page.getByText("+50 (50 total)")).toBeVisible();
  });

  test("a top-up above $50 must be re-confirmed with the amount spelled out", async ({ page }) => {
    await identify(page, RECONFIRM.number);
    await page.getByRole("button", { name: "Yes, top up" }).click();

    await page.getByLabel("Top-up amount in dollars").fill("60");
    await page.getByRole("button", { name: "Top up $60.00" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/sixty dollars/)).toBeVisible();

    await dialog.getByRole("button", { name: "Confirm $60.00" }).click();
    await expect(page.getByText(`Topped up ${RECONFIRM.name}`)).toBeVisible();
  });

  test("an over-cap top-up is blocked for a member with no override field", async ({ page }) => {
    await identify(page, NEARCAP.number);
    await page.getByRole("button", { name: "Yes, top up" }).click();

    await page.getByRole("button", { name: "$10.00", exact: true }).click();
    await expect(page.getByText(/only an exec can override/)).toBeVisible();
    await expect(page.getByLabel("Reason for override")).toHaveCount(0);

    await page.getByRole("button", { name: "Top up $10.00" }).click();
    await expect(page.getByText(/an exec can override with a reason/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Top up $10.00" })).toBeVisible();
  });
});

test.describe("SAC exec top-up", () => {
  test.use({ storageState: SAC_EXEC_STATE });

  test("an exec overrides the cap with a required reason", async ({ page }) => {
    await identify(page, NEARCAP.number);
    await page.getByRole("button", { name: "Yes, top up" }).click();

    await page.getByRole("button", { name: "$10.00", exact: true }).click();

    const submit = page.getByRole("button", { name: "Top up $10.00" });
    await expect(submit).toBeDisabled();

    await page.getByLabel("Reason for override").fill("Class trip prepayment approved by SAC");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page.getByText(`Topped up ${NEARCAP.name}`)).toBeVisible();
    await expect(page.getByText("$209.00")).toBeVisible();
  });
});
