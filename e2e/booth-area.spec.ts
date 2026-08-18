import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { expect, test } from "@playwright/test";
import {
  OPERATOR_NAME,
  OPERATOR_STATE,
  OPERATOR_UID,
  SAC_EXEC_NAME,
  SAC_EXEC_STATE,
  SAC_EXEC_UID,
  TEACHER_STATE,
  TEACHER_UID,
} from "./fixtures";
import { db } from "./helpers/firebase";
import { addItem, enterPaymentCode } from "./helpers/numpad";
import { makeUser, paymentCodeFor } from "./helpers/users";

const RUN_ID = randomUUID().replaceAll("-", "");
const BOOTH_ID = `e2e-p11-booth-${RUN_ID}`;
const BOOTH_NAME = `P11 Booth ${RUN_ID.slice(0, 6)}`;
const BUYER_UID = `e2e-p11-buyer-${RUN_ID}`;
const BUYER_NAME = "P11 Buyer";
const BUYER_STUDENT_NUMBER = "849911";
const JOIN_CODE = "P11A-7K2M9";
const SLICE_ITEM_ID = "p11-slice";
const PIE_ITEM_ID = "p11-pie";
const SLICE_NAME = "P11 Slice";
const PIE_NAME = "P11 Pie";
const NEW_ITEM_NAME = "P11 Combo";

test.beforeAll(async () => {
  const now = Timestamp.now();
  await makeUser({
    uid: BUYER_UID,
    studentNumber: BUYER_STUDENT_NUMBER,
    displayName: BUYER_NAME,
    balanceCents: 50_000,
  });

  await db()
    .collection("booths")
    .doc(BOOTH_ID)
    .set({
      name: BOOTH_NAME,
      nameLower: BOOTH_NAME.toLowerCase(),
      description: "A booth for the P11 end-to-end journey.",
      status: "approved",
      items: [
        { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
        { id: SLICE_ITEM_ID, name: SLICE_NAME, priceCents: 300, isCustom: false },
        { id: PIE_ITEM_ID, name: PIE_NAME, priceCents: 1500, isCustom: false },
      ],
      joinCode: JOIN_CODE,
      submitterUid: TEACHER_UID,
      submitterEmail: "jmurray@pdsb.net",
      createdAt: now,
      approvedAt: now,
      approvedByUid: SAC_EXEC_UID,
    });

  await db()
    .collection("booths")
    .doc(BOOTH_ID)
    .collection("members")
    .doc(OPERATOR_UID)
    .set({ uid: OPERATOR_UID, displayName: OPERATOR_NAME, joinedAt: now });
});

test.describe.serial("P11 · booth area", () => {
  test.describe("member journey and catalog coherence", () => {
    test.use({ storageState: OPERATOR_STATE });

    test("navigates the booth area, sells, recovers a stale price, and writes one sale", async ({
      page,
      browser,
    }) => {
      await page.goto(`/booth/${BOOTH_ID}`);
      await expect(page.getByRole("heading", { name: BOOTH_NAME, level: 1 })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Booth sections" })).toBeVisible();

      await page.getByRole("link", { name: "History", exact: true }).click();
      await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
      await expect(page.getByText("No sales yet.", { exact: true })).toBeVisible();

      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: BOOTH_NAME, level: 1 })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Items & prices", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(SLICE_NAME, { exact: true })).toBeVisible();
      await expect(page.getByText("$3.00", { exact: true })).toBeVisible();
      await expect(page.getByText(JOIN_CODE, { exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Join code");

      await page
        .getByRole("navigation", { name: "Booth sections" })
        .getByRole("link", { name: "Sell", exact: true })
        .click();
      await expect(page.getByRole("heading", { name: BOOTH_NAME, level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: `Add ${SLICE_NAME}` })).toBeVisible();

      await addItem(page, SLICE_NAME);
      await expect(page.getByLabel("Cart total")).toHaveText("$3.00");
      await enterPaymentCode(page, paymentCodeFor(BUYER_UID));
      await expect(page.getByText(`Is this ${BUYER_NAME}?`, { exact: true })).toBeVisible();
      await expect(page.getByText("Funds available", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Charge", exact: true }).click();
      await expect(page.getByText(`Charged $3.00 to ${BUYER_NAME}`, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Cart total")).toHaveText("$0.00");

      await page.getByRole("link", { name: "History", exact: true }).click();
      await expect(page.getByRole("list", { name: "Sales" })).toContainText(BUYER_NAME);
      await page.getByRole("button", { name: "Refresh", exact: true }).click();
      const sales = page.getByRole("list", { name: "Sales" });
      await expect(sales).toContainText(`${SLICE_NAME} × 1 @ $3.00`);
      await expect(sales).toContainText(`by ${OPERATOR_NAME}`);
      const justMine = page.getByRole("button", { name: "Just mine", exact: true });
      await justMine.click();
      await expect(justMine).toHaveAttribute("aria-pressed", "true");
      await expect(sales).toContainText(BUYER_NAME);

      await page
        .getByRole("navigation", { name: "Booth sections" })
        .getByRole("link", { name: "Sell", exact: true })
        .click();
      await expect(page.getByRole("button", { name: `Add ${PIE_NAME}` })).toBeVisible();

      const adminContext = await browser.newContext({
        baseURL: new URL(page.url()).origin,
        storageState: SAC_EXEC_STATE,
      });
      const adminPage = await adminContext.newPage();
      let releaseHeldCharge = () => {};

      try {
        await adminPage.goto(`/admin/booths/${BOOTH_ID}`);
        await expect(adminPage.getByRole("heading", { name: BOOTH_NAME, level: 1 })).toBeVisible();

        await adminPage.getByRole("button", { name: `Archive ${PIE_NAME}` }).click();
        await expect(adminPage.getByText("Item archived.", { exact: true })).toBeVisible();
        await expect(
          adminPage.getByRole("heading", { name: "No longer sold", exact: true }),
        ).toBeVisible();

        await adminPage.locator("#new-item-name").fill(NEW_ITEM_NAME);
        await adminPage.locator("#new-item-price").fill("4.00");
        await adminPage.getByRole("button", { name: "Add item", exact: true }).click();
        await expect(adminPage.getByText("Item added.", { exact: true })).toBeVisible();
        await expect(adminPage.getByText(NEW_ITEM_NAME, { exact: true })).toBeVisible();

        await page.getByRole("button", { name: "Refresh catalog", exact: true }).click();
        await expect(page.getByText("Catalog updated.", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: `Add ${NEW_ITEM_NAME}` })).toBeVisible();
        await expect(page.getByRole("button", { name: `Add ${PIE_NAME}` })).toHaveCount(0);
        await expect(
          page.getByText(`${NEW_ITEM_NAME} added at $4.00`, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(`${PIE_NAME} — no longer sold (removed from cart)`, { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("$3.00", { exact: true })).toBeVisible();

        await addItem(page, SLICE_NAME);
        await expect(page.getByLabel("Cart total")).toHaveText("$3.00");
        await enterPaymentCode(page, paymentCodeFor(BUYER_UID));
        await expect(page.getByText("Funds available", { exact: true })).toBeVisible();

        const chargeKeys: string[] = [];
        let observeFirstCharge!: () => void;
        const firstChargeObserved = new Promise<void>((resolve) => {
          observeFirstCharge = resolve;
        });
        const chargeGate = new Promise<void>((resolve) => {
          releaseHeldCharge = resolve;
        });
        let holdFirstCharge = true;

        await page.route("**/api/booth/charge", async (route) => {
          chargeKeys.push(route.request().headers()["idempotency-key"] ?? "");
          if (holdFirstCharge) {
            holdFirstCharge = false;
            observeFirstCharge();
            await chargeGate;
          }
          await route.continue();
        });

        const chargeClick = page.getByRole("button", { name: "Charge", exact: true }).click();
        await firstChargeObserved;

        await adminPage.getByLabel(`${SLICE_NAME} price in dollars`).fill("3.50");
        await adminPage.getByRole("button", { name: "Save prices", exact: true }).click();
        await expect(adminPage.getByText("Prices updated.", { exact: true })).toBeVisible();

        releaseHeldCharge();
        await chargeClick;
        await expect(
          page.getByText("Prices changed — refresh the menu and confirm the new total.", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Confirm price changes", exact: true }),
        ).toBeVisible();
        await expect(page.locator('[aria-label="Catalog changes"]')).toContainText(
          `${SLICE_NAME} $3.00 → $3.50`,
        );
        await expect(page.getByLabel("Cart total")).toHaveText("$3.50");
        await expect(page.getByRole("button", { name: "Charge", exact: true })).toBeDisabled();

        await page.getByRole("button", { name: "Confirm price changes", exact: true }).click();
        await page.getByRole("button", { name: "Charge", exact: true }).click();
        await expect(
          page.getByText(`Charged $3.50 to ${BUYER_NAME}`, { exact: true }),
        ).toBeVisible();

        expect(chargeKeys).toHaveLength(2);
        expect(chargeKeys[0]).not.toBe("");
        expect(chargeKeys[1]).not.toBe("");
        expect(new Set(chargeKeys).size).toBe(2);

        const rejectedEntry = await db()
          .collection("ledger")
          .where("idempotencyKey", "==", chargeKeys[0])
          .get();
        const committedEntry = await db()
          .collection("ledger")
          .where("idempotencyKey", "==", chargeKeys[1])
          .get();
        expect(rejectedEntry.size).toBe(0);
        expect(committedEntry.size).toBe(1);
        expect(committedEntry.docs[0]!.data()).toMatchObject({
          amountCents: 350,
          boothId: BOOTH_ID,
          lineItems: [{ itemId: SLICE_ITEM_ID, name: SLICE_NAME, qty: 1, unitPriceCents: 350 }],
        });
      } finally {
        releaseHeldCharge();
        await adminContext.close();
      }
    });
  });

  test.describe("exec selling and audit", () => {
    test.use({ storageState: SAC_EXEC_STATE });

    test("sells for a booth without joining it and shows the audit entry", async ({ page }) => {
      await page.goto(`/admin/booths/${BOOTH_ID}`);
      await expect(
        page.getByRole("link", { name: "Sell for this booth", exact: true }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Sell for this booth", exact: true }).click();
      await expect(page.getByRole("link", { name: "Booth admin", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "History", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

      await addItem(page, "Custom");
      await expect(page.getByLabel("Cart total")).toHaveText("$0.50");
      await enterPaymentCode(page, paymentCodeFor(BUYER_UID));
      await expect(page.getByText("Funds available", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Charge", exact: true }).click();
      await expect(page.getByText(`Charged $0.50 to ${BUYER_NAME}`, { exact: true })).toBeVisible();

      const audits = await db()
        .collection("auditLog")
        .where("action", "==", "booth.execCharge")
        .get();
      const matchingAudits = audits.docs.filter((doc) => {
        const data = doc.data();
        return data.actorUid === SAC_EXEC_UID && data.targetId === BOOTH_ID;
      });
      expect(matchingAudits).toHaveLength(1);

      await page.goto("/admin");
      const auditRow = page
        .getByRole("listitem")
        .filter({ hasText: "Sold for booth" })
        .filter({ hasText: BOOTH_NAME });
      await expect(auditRow).toContainText(BOOTH_NAME);
      await expect(auditRow).toContainText(SAC_EXEC_NAME);
    });
  });

  test.describe("registration draft", () => {
    test.use({ storageState: TEACHER_STATE });

    test("restores a booth request draft after a reload", async ({ page }) => {
      await page.goto("/request-booth");
      await page.locator("#booth-name").fill("P11 Draft Booth");
      await page.locator("#booth-description").fill("A draft that survives reload.");
      await page.locator("#item-name-0").fill("P11 Draft Item");
      await page.locator("#item-price-0").fill("2.50");

      await page.reload();
      const restoreDialog = page.getByRole("alertdialog", { name: "Restore your draft?" });
      await expect(restoreDialog).toBeVisible();
      await restoreDialog.getByRole("button", { name: "Restore", exact: true }).click();
      await expect(page.locator("#booth-name")).toHaveValue("P11 Draft Booth");
      await expect(page.locator("#booth-description")).toHaveValue("A draft that survives reload.");
      await expect(page.locator("#item-name-0")).toHaveValue("P11 Draft Item");
      await expect(page.locator("#item-price-0")).toHaveValue("2.50");
    });
  });
});
