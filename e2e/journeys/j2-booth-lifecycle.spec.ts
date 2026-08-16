import { expect, test } from "@playwright/test";
import {
  APPROVED_BOOTH_ID,
  BUYER_NAME,
  BUYER_UID,
  DEACTIVATED_BOOTH_ID,
  PENDING_BOOTH_SUBMITTER,
  SAC_EXEC_STATE,
  SAC_MEMBER_STATE,
  TEACHER_STATE,
} from "../fixtures";
import { db } from "../helpers/firebase";
import { addItem, enterPaymentCode } from "../helpers/numpad";
import { warmShell } from "../helpers/sw";
import { makeUser, paymentCodeFor, paymentCodeOf } from "../helpers/users";

const SUFFIX = "[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}";
const CODE = new RegExp(`^[A-Z]{4}-${SUFFIX}$`);
const RELAY_NAME = "Relay Stand";
const RELAY_CODE = new RegExp(`^RELA-${SUFFIX}$`);

const J2_BUYER = { uid: "e2e-j2-buyer", studentNumber: "849101", name: "Bianca Buyer" };

test.beforeAll(async () => {
  await makeUser({
    uid: J2_BUYER.uid,
    studentNumber: J2_BUYER.studentNumber,
    displayName: J2_BUYER.name,
    balanceCents: 50_000,
  });
});

test.describe.serial("J2 · booth lifecycle: register → approve → join → sale", () => {
  let boothId = "";
  let joinCode = "";

  test.describe("registration", () => {
    test.use({ storageState: TEACHER_STATE });

    test("the retired registration route permanently redirects", async ({ page }) => {
      const response = await page.request.get("/booths/register", { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(response.headers().location).toBe("/request-booth");
    });

    test("a teacher registers a booth and it lands pending", async ({ page }) => {
      await page.goto("/request-booth");
      await expect(page.getByRole("heading", { name: "Request a booth" })).toBeVisible();

      await page.locator("#booth-name").fill(RELAY_NAME);
      await page.locator("#booth-description").fill("End-to-end lifecycle booth.");
      await page.locator("#item-name-0").fill("Ticket");
      await page.locator("#item-price-0").fill("2");

      await page.getByRole("button", { name: "Submit for review" }).click();
      await expect(page.getByRole("heading", { name: "Booth submitted" })).toBeVisible();

      const snap = await db()
        .collection("booths")
        .where("nameLower", "==", RELAY_NAME.toLowerCase())
        .limit(1)
        .get();
      expect(snap.size).toBe(1);
      boothId = snap.docs[0]!.id;
      expect(snap.docs[0]!.data().status).toBe("pending");
    });
  });

  test.describe("approval", () => {
    test.use({ storageState: SAC_EXEC_STATE });

    test("an exec approves it, surfacing the submitter and a fresh join code", async ({ page }) => {
      await page.goto(`/admin/booths/${boothId}`);
      await expect(page.getByRole("heading", { name: RELAY_NAME })).toBeVisible();
      await expect(page.getByText(PENDING_BOOTH_SUBMITTER)).toBeVisible();

      await page.getByRole("button", { name: "Approve booth" }).click();

      await expect(page.getByText("Booth approved — join code ready.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Join code" })).toBeVisible();

      const codeEl = page.getByText(RELAY_CODE);
      await expect(codeEl).toBeVisible();
      joinCode = (await codeEl.textContent())!.trim();
    });
  });

  test.describe("join & sale", () => {
    test("a member joins with the code and sells to a buyer", async ({ page }) => {
      await page.goto("/booths/join");
      await page.locator("#join-code").fill(joinCode);
      await page.getByRole("button", { name: "Join booth" }).click();
      await expect(page.getByRole("heading", { name: "You're in" })).toBeVisible();
      await expect(page.getByText(`member of ${RELAY_NAME}`)).toBeVisible();

      await page.goto(`/sell/${boothId}`);
      await expect(page.getByRole("heading", { name: RELAY_NAME })).toBeVisible();

      await addItem(page, "Ticket");
      await expect(page.getByLabel("Cart total")).toHaveText("$2.00");

      await enterPaymentCode(page, paymentCodeFor(J2_BUYER.uid));
      await expect(page.getByText(`Is this ${J2_BUYER.name}?`)).toBeVisible();
      await expect(page.getByText("Funds available")).toBeVisible();

      await page.getByRole("button", { name: "Charge" }).click();
      await expect(page.getByText(`Charged $2.00 to ${J2_BUYER.name}`)).toBeVisible();
      await expect(page.getByLabel("Cart total")).toHaveText("$0.00");
    });
  });
});

test.describe("J2 · POS terminal", () => {
  test("build cart with custom ×N, identify by payment code, sufficiency, charge succeeds", async ({
    page,
  }) => {
    await page.goto(`/sell/${APPROVED_BOOTH_ID}`);
    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();

    await addItem(page, "Slice");
    await addItem(page, "Custom", 3);
    await expect(page.getByLabel("Cart total")).toHaveText("$4.50");

    await enterPaymentCode(page, await paymentCodeOf(BUYER_UID));
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

    await enterPaymentCode(page, await paymentCodeOf(BUYER_UID));
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

    await enterPaymentCode(page, await paymentCodeOf(BUYER_UID));
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

  test("a re-rung identical cart reuses the held key and reports the replay, not a second sale", async ({
    page,
  }) => {
    const idempotencyKeys: string[] = [];
    let swallowResponses = true;

    await page.route("**/api/booth/charge", async (route) => {
      idempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (!swallowResponses) {
        await route.continue();
        return;
      }
      if (idempotencyKeys.length === 1) await route.fetch();
      await route.abort("failed");
    });

    await page.goto(`/sell/${APPROVED_BOOTH_ID}`);
    await addItem(page, "Slice");
    await enterPaymentCode(page, await paymentCodeOf(BUYER_UID));
    await expect(page.getByText("Funds available")).toBeVisible();

    await page.getByRole("button", { name: "Charge" }).click();
    await expect(page.getByText(/Couldn't reach the server/)).toBeVisible();
    expect(idempotencyKeys.length).toBe(3);

    swallowResponses = false;
    await page.getByRole("button", { name: "Charge" }).click();
    await expect(page.getByText(/Already processed — no new charge/)).toBeVisible();
    await expect(page.getByText(`Charged $3.00 to ${BUYER_NAME}`)).toHaveCount(0);

    expect(new Set(idempotencyKeys).size).toBe(1);
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

  test("POS shell reopens offline with the offline banner (NFR-1)", async ({ page }) => {
    const path = `/sell/${APPROVED_BOOTH_ID}`;
    await warmShell(page, path);

    await page.context().setOffline(true);
    await page.goto(path);

    await expect(page.getByRole("heading", { name: "Pizza Palace" })).toBeVisible();
    await expect(page.getByText("You're offline")).toBeVisible();
  });
});

test.describe("J2 · exec booth management", () => {
  test.use({ storageState: SAC_EXEC_STATE });

  test("rotating a join code replaces the displayed code", async ({ page }) => {
    await page.goto(`/admin/booths/${APPROVED_BOOTH_ID}`);
    await expect(page.getByText("PIZZ-9K4M7")).toBeVisible();

    await page.getByRole("button", { name: "Rotate code" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Rotate code" }).click();

    await expect(page.getByText("Join code rotated.")).toBeVisible();
    await expect(page.getByText("PIZZ-9K4M7")).toHaveCount(0);
    await expect(page.getByText(CODE)).toBeVisible();
  });
});

test.describe("J2 · member booth view", () => {
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
