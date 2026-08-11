import { expect, test } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import {
  APPROVED_BOOTH_ID,
  DEACTIVATED_BOOTH_ID,
  OPERATOR_NAME,
  OPERATOR_UID,
  SAC_MEMBER_STATE,
} from "../fixtures";
import { db } from "../helpers/firebase";

const CHARGE = {
  studentUid: "e2e-feed-buyer",
  studentNumber: "880009",
  studentName: "Fiona Feed",
};

const LEADERBOARD_SALES = [
  {
    id: "e2e-leaderboard-pizza",
    boothId: APPROVED_BOOTH_ID,
    boothName: "Pizza Palace",
    amountCents: 200,
  },
  {
    id: "e2e-leaderboard-candy",
    boothId: DEACTIVATED_BOOTH_ID,
    boothName: "Candy Corner",
    amountCents: 100,
  },
] as const;

test.describe("J8 · leaderboard + feed observation", () => {
  test.describe("leaderboard", () => {
    test("ranks booths by gross sales", async ({ page }) => {
      const batch = db().batch();
      for (const sale of LEADERBOARD_SALES) {
        batch.set(db().collection("ledger").doc(sale.id), {
          type: "purchase",
          amountCents: sale.amountCents,
          direction: "debit",
          balanceAfterCents: 0,
          studentUid: "e2e-leaderboard-buyer",
          studentNumber: "880008",
          studentName: "Lena Leaderboard",
          actorUid: OPERATOR_UID,
          actorName: OPERATOR_NAME,
          tags: [],
          idempotencyKey: sale.id,
          createdAt: Timestamp.now(),
          createdDate: "2026-07-26",
          boothId: sale.boothId,
          boothName: sale.boothName,
          lineItems: [
            {
              itemId: "leaderboard-item",
              name: "Leaderboard item",
              qty: 1,
              unitPriceCents: sale.amountCents,
            },
          ],
        });
      }
      await batch.commit();

      await page.goto("/leaderboard");
      await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
      await expect(page.getByText("No sales yet.")).toHaveCount(0);

      const rows = page.getByRole("listitem");
      const grossCents = (await rows.allTextContents()).map((text) => {
        const gross = text.match(/\$([\d,]+\.\d{2})/);
        expect(gross).not.toBeNull();
        return Math.round(Number(gross![1]!.replaceAll(",", "")) * 100);
      });

      expect(new Set(grossCents).size).toBeGreaterThan(1);
      expect(grossCents).toEqual([...grossCents].sort((a, b) => b - a));
    });
  });

  test.describe("feed", () => {
    test.use({ storageState: SAC_MEMBER_STATE });

    test("a charge lands in the feed on refresh and is flagged high-amount", async ({ page }) => {
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

      await page.getByRole("button", { name: "Refresh" }).click();

      const list = page.getByRole("list", { name: "Transactions" });
      const row = list.locator("li").filter({ hasText: CHARGE.studentName });
      await expect(row).toBeVisible();
      await expect(row.getByText("High amount")).toBeVisible();

      await row.getByRole("button", { name: "Show details" }).click();
      await expect(row.getByText(/Slice × 1/)).toBeVisible();
    });
  });
});
