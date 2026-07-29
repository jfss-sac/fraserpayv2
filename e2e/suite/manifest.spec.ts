import { expect, test } from "@playwright/test";

const PNG_SIGNATURE = "89504e470d0a1a0a";

test.describe("PWA manifest & installability", () => {
  test("serves a manifest that parses with installability fields", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("manifest");

    const manifest = await response.json();
    expect(manifest.name).toBe("FraserPay");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/wallet");

    const has = (sizes: string, purpose: string) =>
      manifest.icons.some(
        (i: { sizes: string; purpose?: string }) =>
          i.sizes === sizes && (i.purpose ?? "any") === purpose,
      );
    expect(has("192x192", "any")).toBe(true);
    expect(has("512x512", "any")).toBe(true);
    expect(has("512x512", "maskable")).toBe(true);
  });

  test("serves every manifest icon as a real PNG", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    for (const icon of manifest.icons) {
      const res = await request.get(icon.src);
      expect(res.ok(), `${icon.src} should be served`).toBe(true);
      expect(res.headers()["content-type"]).toContain("image/png");
      const body = await res.body();
      expect(body.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
    }
  });

  test("wallet HTML links the manifest and an apple-touch icon", async ({ page }) => {
    await page.route("**/api/wallet", (route) => route.abort());
    await page.goto("/wallet");
    await expect(page.locator("link[rel='manifest']")).toHaveAttribute(
      "href",
      /manifest\.webmanifest/,
    );
    await expect(page.locator("link[rel='apple-touch-icon']")).toHaveAttribute(
      "href",
      /apple-touch-icon\.png/,
    );
  });
});
