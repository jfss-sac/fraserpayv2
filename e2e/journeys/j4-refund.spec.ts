import { expect, test } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { APPROVED_BOOTH_ID, SAC_EXEC_STATE, SAC_MEMBER_NAME, SAC_MEMBER_UID } from "../fixtures";
import { db } from "../helpers/firebase";
import { makeUser } from "../helpers/users";

const TARGET = { uid: "e2e-j4-target", number: "880041", name: "Percy Purchase" };
const PURCHASE_ID = "e2e-j4-purchase";

test.use({ storageState: SAC_EXEC_STATE });

test.beforeAll(async () => {
  const stale = await db().collection("ledger").where("studentUid", "==", TARGET.uid).get();
  await Promise.all(stale.docs.map((doc) => doc.ref.delete()));

  await makeUser({
    uid: TARGET.uid,
    studentNumber: TARGET.number,
    displayName: TARGET.name,
    balanceCents: 1400,
    points: 100,
  });

  await db()
    .collection("ledger")
    .doc(PURCHASE_ID)
    .set({
      type: "purchase",
      amountCents: 600,
      direction: "debit",
      balanceAfterCents: 1400,
      studentUid: TARGET.uid,
      studentNumber: TARGET.number,
      studentName: TARGET.name,
      actorUid: SAC_MEMBER_UID,
      actorName: SAC_MEMBER_NAME,
      tags: [],
      idempotencyKey: PURCHASE_ID,
      createdAt: Timestamp.now(),
      createdDate: "2026-07-20",
      boothId: APPROVED_BOOTH_ID,
      boothName: "Pizza Palace",
      lineItems: [{ itemId: "slice", name: "Slice", qty: 2, unitPriceCents: 300 }],
    });
});

test.describe("J4 · dispute → refund", () => {
  test("an exec refunds a purchase in full and the balance rises", async ({ page }) => {
    await page.goto(`/admin/students/${TARGET.uid}`);
    await expect(page.getByRole("heading", { name: TARGET.name })).toBeVisible();

    const balanceCard = page.getByText("Balance", { exact: true }).locator("xpath=..");
    await expect(balanceCard.getByText("$14.00")).toBeVisible();

    const purchaseRow = page.locator("li").filter({ hasText: "Pizza Palace" }).first();
    await purchaseRow.getByRole("button", { name: "Refund" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Reason").fill("duplicate charge — dispute upheld");
    await dialog.getByRole("button", { name: "Refund remaining" }).click();

    await expect(page.getByText("Refund issued.")).toBeVisible();
    await expect(balanceCard.getByText("$20.00")).toBeVisible();
    await expect(page.getByText("Refund · Pizza Palace")).toBeVisible();
  });
});
