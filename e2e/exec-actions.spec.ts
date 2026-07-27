import { expect, test } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { APPROVED_BOOTH_ID, SAC_EXEC_STATE, SAC_MEMBER_NAME, SAC_MEMBER_UID } from "./fixtures";
import { db } from "./helpers/firebase";

const TARGET = {
  uid: "e2e-exec-target",
  studentNumber: "880050",
  name: "Percy Purchase",
  paymentCode: "fp1-e2e-exec-target",
};

const TOPUP_ID = "e2e-exec-topup";
const PURCHASE_ID = "e2e-exec-purchase";

test.use({ storageState: SAC_EXEC_STATE });

test.beforeAll(async () => {
  const stale = await db().collection("ledger").where("studentUid", "==", TARGET.uid).get();
  await Promise.all(stale.docs.map((doc) => doc.ref.delete()));

  await db()
    .collection("users")
    .doc(TARGET.uid)
    .set({
      email: `${TARGET.studentNumber}@pdsb.net`,
      displayName: TARGET.name,
      displayNameLower: TARGET.name.toLowerCase(),
      studentNumber: TARGET.studentNumber,
      paymentCode: TARGET.paymentCode,
      balanceCents: 1400,
      points: 100,
      roles: { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

  await db()
    .collection("ledger")
    .doc(TOPUP_ID)
    .set({
      type: "topup",
      amountCents: 2000,
      direction: "credit",
      balanceAfterCents: 2000,
      studentUid: TARGET.uid,
      studentNumber: TARGET.studentNumber,
      studentName: TARGET.name,
      actorUid: SAC_MEMBER_UID,
      actorName: SAC_MEMBER_NAME,
      method: "cash",
      tags: [],
      pointsDelta: 100,
      idempotencyKey: TOPUP_ID,
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
      createdDate: "2026-07-20",
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
      studentNumber: TARGET.studentNumber,
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

test("an exec applies a top-up-linked adjustment that previews the points reversal", async ({
  page,
}) => {
  await page.goto(`/admin/students/${TARGET.uid}`);

  const pointsCard = page.getByText("Points", { exact: true }).locator("xpath=..");
  await expect(pointsCard.getByText("100")).toBeVisible();

  await page.getByRole("button", { name: "Adjust balance" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Remove credit" }).click();
  await dialog.getByLabel("Adjustment amount in dollars").fill("5");
  await dialog.getByLabel("Link to a top-up (reverses its points)").selectOption(TOPUP_ID);

  const preview = dialog.getByRole("status");
  await expect(preview).toContainText("-25");
  await expect(preview).toContainText("75 total");

  await dialog.getByLabel("Reason").fill("partial reversal of erroneous top-up");
  await dialog.getByRole("button", { name: "Apply adjustment" }).click();

  await expect(page.getByText("Balance adjusted.")).toBeVisible();
  await expect(pointsCard.getByText("75")).toBeVisible();
});
