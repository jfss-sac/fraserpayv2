import { expect, test } from "@playwright/test";
import { APPROVED_BOOTH_ID, SAC_EXEC_STATE } from "../fixtures";
import { addItem, enterStudentNumber } from "../helpers/numpad";
import { makeUser } from "../helpers/users";

const TOGGLE = { uid: "e2e-j6-toggle", number: "849501", name: "Suzy Suspend" };
const BLOCKED = { uid: "e2e-j6-blocked", number: "849601", name: "Blocke Buyer" };

test.beforeAll(async () => {
  await makeUser({ uid: TOGGLE.uid, studentNumber: TOGGLE.number, displayName: TOGGLE.name });
  await makeUser({
    uid: BLOCKED.uid,
    studentNumber: BLOCKED.number,
    displayName: BLOCKED.name,
    balanceCents: 5_000,
    suspended: true,
  });
});

test.describe("J6 · suspension mid-flow", () => {
  test.describe("exec suspend / unsuspend", () => {
    test.use({ storageState: SAC_EXEC_STATE });

    test("an exec suspends then unsuspends an account", async ({ page }) => {
      await page.goto(`/admin/students/${TOGGLE.uid}`);
      await expect(page.getByRole("heading", { name: TOGGLE.name })).toBeVisible();

      await page.getByRole("button", { name: "Suspend account" }).click();
      const suspendDialog = page.getByRole("dialog");
      await expect(suspendDialog.getByRole("heading", { name: "Suspend account?" })).toBeVisible();
      await suspendDialog.getByRole("button", { name: "Suspend", exact: true }).click();

      await expect(page.getByText("Account suspended.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Unsuspend account" })).toBeVisible();

      await page.getByRole("button", { name: "Unsuspend account" }).click();
      const unsuspendDialog = page.getByRole("dialog");
      await unsuspendDialog.getByRole("button", { name: "Unsuspend", exact: true }).click();

      await expect(page.getByText("Account unsuspended.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Suspend account" })).toBeVisible();
    });
  });

  test.describe("suspension blocks a sale", () => {
    test("a suspended buyer cannot be charged at the POS", async ({ page }) => {
      await page.goto(`/sell/${APPROVED_BOOTH_ID}`);
      await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();

      await addItem(page, "Slice");
      await enterStudentNumber(page, BLOCKED.number);

      await expect(page.getByText("This account is suspended — send them to SAC.")).toBeVisible();
      await expect(page.getByText("Funds available")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Charge" })).toBeDisabled();
    });
  });
});
