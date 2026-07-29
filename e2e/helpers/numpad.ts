import type { Page } from "@playwright/test";

export async function enterStudentNumber(page: Page, studentNumber: string): Promise<void> {
  for (const digit of studentNumber) {
    await page.getByRole("button", { name: `Digit ${digit}`, exact: true }).click();
  }
  await page.getByRole("button", { name: "Look up student" }).click();
}

export async function addItem(page: Page, name: string, times = 1): Promise<void> {
  const add = page.getByRole("button", { name: `Add ${name}` });
  for (let i = 0; i < times; i++) await add.click();
}
