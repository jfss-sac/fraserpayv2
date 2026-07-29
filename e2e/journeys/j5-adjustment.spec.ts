import { expect, test } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { SAC_EXEC_STATE, SAC_MEMBER_NAME, SAC_MEMBER_UID } from "../fixtures";
import { db } from "../helpers/firebase";
import { makeUser } from "../helpers/users";

const TARGET = { uid: "e2e-j5-target", number: "880051", name: "Tara Topupfix" };
const TOPUP_ID = "e2e-j5-topup";

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
    .doc(TOPUP_ID)
    .set({
      type: "topup",
      amountCents: 2000,
      direction: "credit",
      balanceAfterCents: 2000,
      studentUid: TARGET.uid,
      studentNumber: TARGET.number,
      studentName: TARGET.name,
      actorUid: SAC_MEMBER_UID,
      actorName: SAC_MEMBER_NAME,
      method: "cash",
      tags: [],
      pointsDelta: 100,
      idempotencyKey: TOPUP_ID,
      createdAt: Timestamp.fromMillis(Timestamp.now().toMillis() - 60_000),
      createdDate: "2026-07-20",
    });
});

test.describe("J5 · wrong top-up → linked adjustment", () => {
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
});
