import { expect, test } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { APPROVED_BOOTH_ID, OPERATOR_NAME, OPERATOR_UID, SAC_MEMBER_STATE } from "../fixtures";
import { db } from "../helpers/firebase";

const ONE_POLL_CYCLE_MS = 60_000;

const CHARGE = {
  studentUid: "e2e-feed-buyer",
  studentNumber: "880009",
  studentName: "Fiona Feed",
};

test.describe("J8 · leaderboard + feed observation", () => {
  test.describe("leaderboard", () => {
    test("ranks booths by gross sales", async ({ page }) => {
      await page.goto("/leaderboard");
      await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
      await expect(page.getByText("No sales yet.")).toHaveCount(0);

      const row = page.getByRole("listitem").filter({ hasText: "Pizza Palace" });
      await expect(row).toBeVisible();
      await expect(row.getByText(/\$\d/)).toBeVisible();
    });
  });

  test.describe("feed", () => {
    test.use({ storageState: SAC_MEMBER_STATE });

    test("a charge lands in the live feed within one poll cycle and is flagged high-amount", async ({
      page,
    }) => {
      test.setTimeout(ONE_POLL_CYCLE_MS + 60_000);
      await db().collection("ledger").doc("e2e-feed-charge").delete();

      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Feed" })).toBeVisible();
      await expect(page.getByText(CHARGE.studentName)).toHaveCount(0);

      await db()
        .collection("ledger")
        .doc("e2e-feed-charge")
        .set({
          type: "purchase",
          amountCents: 2000,
          direction: "debit",
          balanceAfterCents: 500,
          studentUid: CHARGE.studentUid,
          studentNumber: CHARGE.studentNumber,
          studentName: CHARGE.studentName,
          actorUid: OPERATOR_UID,
          actorName: OPERATOR_NAME,
          tags: ["high-amount"],
          idempotencyKey: "e2e-feed-charge",
          createdAt: Timestamp.now(),
          createdDate: "2026-07-26",
          boothId: APPROVED_BOOTH_ID,
          boothName: "Pizza Palace",
          lineItems: [{ itemId: "slice", name: "Slice", qty: 1, unitPriceCents: 2000 }],
        });

      const indicator = page.getByRole("button", { name: /new transaction/ });
      await expect(indicator).toBeVisible({ timeout: ONE_POLL_CYCLE_MS + 10_000 });
      await indicator.click();

      const list = page.getByRole("list", { name: "Transactions" });
      const row = list.locator("li").filter({ hasText: CHARGE.studentName });
      await expect(row).toBeVisible();
      await expect(row.getByText("High amount")).toBeVisible();

      await row.getByRole("button", { name: "Show details" }).click();
      await expect(row.getByText(/Slice × 1/)).toBeVisible();
    });
  });
});
