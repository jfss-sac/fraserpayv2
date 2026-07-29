import { type Locator, type Page, expect, test } from "@playwright/test";
import { SAC_EXEC_STATE, SAC_EXEC_UID } from "../fixtures";
import { signInAs } from "../helpers/auth";
import { makeUser } from "../helpers/users";

const STUDENT = { uid: "e2e-j7-student", number: "849701", name: "Grady Grantee" };

function roleRow(page: Page, label: string): Locator {
  return page.getByText(`${label} ·`).locator("xpath=..");
}

test.use({ storageState: SAC_EXEC_STATE });

test.beforeAll(async () => {
  await makeUser({ uid: STUDENT.uid, studentNumber: STUDENT.number, displayName: STUDENT.name });
});

test.describe("J7 · role grant / revoke", () => {
  test("granting SAC member unlocks /admin for the student; revoking locks it again", async ({
    page,
    browser,
  }) => {
    await page.goto(`/admin/students/${STUDENT.uid}`);
    await expect(page.getByRole("heading", { name: STUDENT.name })).toBeVisible();

    const memberRow = roleRow(page, "SAC member");
    await memberRow.getByRole("button", { name: "Grant" }).click();
    const grantDialog = page.getByRole("dialog");
    await expect(grantDialog.getByRole("heading", { name: "Grant SAC member?" })).toBeVisible();
    await grantDialog.getByRole("button", { name: "Grant", exact: true }).click();

    await expect(page.getByText("Role granted.")).toBeVisible();
    await expect(memberRow.getByRole("button", { name: "Revoke" })).toBeVisible();

    const origin = new URL(page.url()).origin;

    const grantedCtx = await browser.newContext({ baseURL: origin });
    const grantedPage = await grantedCtx.newPage();
    await signInAs(grantedPage, STUDENT.uid);
    await grantedPage.goto("/admin");
    await expect(grantedPage.getByRole("heading", { name: "Feed" })).toBeVisible();
    await grantedCtx.close();

    await memberRow.getByRole("button", { name: "Revoke" }).click();
    const revokeDialog = page.getByRole("dialog");
    await expect(revokeDialog.getByRole("heading", { name: "Revoke SAC member?" })).toBeVisible();
    await revokeDialog.getByRole("button", { name: "Revoke", exact: true }).click();

    await expect(page.getByText("Role revoked.")).toBeVisible();
    await expect(memberRow.getByRole("button", { name: "Grant" })).toBeVisible();

    const revokedCtx = await browser.newContext({ baseURL: origin });
    const revokedPage = await revokedCtx.newPage();
    await signInAs(revokedPage, STUDENT.uid);
    await revokedPage.goto("/admin");
    await expect(revokedPage.getByRole("heading", { name: "Feed" })).toHaveCount(0);
    await revokedCtx.close();
  });

  test("the last SAC exec cannot be revoked", async ({ page }) => {
    await page.goto(`/admin/students/${SAC_EXEC_UID}`);

    const execRow = roleRow(page, "SAC exec");
    await execRow.getByRole("button", { name: "Revoke" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Revoke SAC exec?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Revoke", exact: true }).click();

    await expect(page.getByText(/last SAC exec/)).toBeVisible();
    await expect(roleRow(page, "SAC exec").getByRole("button", { name: "Revoke" })).toBeVisible();
  });
});
