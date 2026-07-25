import { gzipSync } from "node:zlib";
import { type Response, expect, test } from "@playwright/test";

const BUDGET_BYTES = 170 * 1024;

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

test.describe("Wallet transfer budget (NFR-2)", () => {
  test("first wallet load stays within the compressed transfer budget", async ({ page }) => {
    await page.route("**/sw.js", (route) => route.abort());

    const responses: Response[] = [];
    page.on("response", (response) => responses.push(response));

    await page.goto("/wallet");
    await page.waitForLoadState("networkidle");

    const origin = new URL(page.url()).origin;
    let total = 0;
    for (const response of responses) {
      const url = response.url();
      if (!sameOrigin(url, origin)) continue;
      if (url.includes("_rsc=")) continue;
      const body = await response.body().catch(() => Buffer.alloc(0));
      if (body.length === 0) continue;
      total += gzipSync(body).length;
    }

    console.log(`[budget] first wallet load: ${total} bytes compressed (limit ${BUDGET_BYTES})`);
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  test("wallet route pulls no firebase or shadcn chunks", async ({ page }) => {
    await page.route("**/sw.js", (route) => route.abort());

    const scriptUrls: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      scriptUrls.push(response.url());
    });

    await page.goto("/wallet");
    await page.waitForLoadState("networkidle");

    expect(scriptUrls.length).toBeGreaterThan(0);
    for (const url of scriptUrls) {
      const body = await (await page.request.get(url)).text();
      expect(body, `${url} must not bundle Firebase`).not.toMatch(/firebase/i);
      expect(body, `${url} must not bundle shadcn/Radix`).not.toMatch(/radix-ui|shadcn/i);
    }
  });
});
