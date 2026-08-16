import { type Page, expect, test } from "@playwright/test";
import { APPROVED_BOOTH_ID, BUYER_UID, SAC_MEMBER_STATE } from "../fixtures";

const OPERATOR_ROUTES = ["/wallet", "/leaderboard", "/booths/join", "/request-booth", "/sell"];
const BOOTH_ROUTES = [`/sell/${APPROVED_BOOTH_ID}`, `/booth/${APPROVED_BOOTH_ID}`];
const SAC_ROUTES = [
  "/admin",
  "/admin/activity",
  "/admin/booths",
  `/admin/booths/${APPROVED_BOOTH_ID}`,
  "/admin/reconciliation",
  "/admin/reports",
  "/admin/students",
  `/admin/students/${BUYER_UID}`,
  "/admin/topup",
];

async function headOf(page: Page, path: string) {
  await page.goto(path);
  return {
    title: await page.title(),
    h1s: await page.locator("h1").allTextContents(),
    canonical: await page.locator('link[rel="canonical"]').getAttribute("href"),
    robots: await page.locator('meta[name="robots"]').first().getAttribute("content"),
    description: await page.locator('meta[name="description"]').getAttribute("content"),
  };
}

function expectWellFormed(head: Awaited<ReturnType<typeof headOf>>, path: string): void {
  expect(head.h1s, `${path} must have exactly one <h1>`).toHaveLength(1);
  expect(head.h1s[0]?.trim(), `${path} <h1> must not be empty`).not.toBe("");
  expect(head.title.endsWith(" · FraserPay"), `${path} title must be brand-suffixed`).toBe(true);
  expect(head.description, `${path} must carry a meta description`).toBeTruthy();
  expect(head.canonical, `${path} must carry a canonical URL`).toContain(path);
}

test.describe("Document head — authenticated routes", () => {
  test("student and booth routes each have one h1, a distinct title, and a canonical", async ({
    page,
  }) => {
    const seen = new Map<string, string>();
    for (const path of [...OPERATOR_ROUTES, ...BOOTH_ROUTES]) {
      const head = await headOf(page, path);
      expectWellFormed(head, path);
      expect(head.robots, `${path} must not be indexable`).toContain("noindex");
      expect(
        seen.get(head.title),
        `${path} duplicates the title of ${seen.get(head.title)}`,
      ).toBeUndefined();
      seen.set(head.title, path);
    }
  });
});

test.describe("Document head — SAC routes", () => {
  test.use({ storageState: SAC_MEMBER_STATE });

  test("admin routes each have one h1, a distinct title, and a canonical", async ({ page }) => {
    const seen = new Map<string, string>();
    for (const path of SAC_ROUTES) {
      const head = await headOf(page, path);
      expectWellFormed(head, path);
      expect(head.robots, `${path} must not be indexable`).toContain("noindex");
      expect(
        seen.get(head.title),
        `${path} duplicates the title of ${seen.get(head.title)}`,
      ).toBeUndefined();
      seen.set(head.title, path);
    }
  });
});

test.describe("Document head — public and error surfaces", () => {
  test("requesting a booth requires a session and lands on login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/request-booth");
    await expect(page).toHaveURL(/\/login\?next=%2Frequest-booth/);
  });

  test("the sign-in page is the only indexable route and carries a full share card", async ({
    page,
  }) => {
    await page.context().clearCookies();
    const head = await headOf(page, "/login");

    expect(head.h1s).toHaveLength(1);
    expect(head.title.startsWith("FraserPay")).toBe(true);
    expect(head.title.match(/FraserPay/g)).toHaveLength(1);
    expect(head.description).toContain("FraserPay");
    expect(head.robots).toContain("index");
    expect(head.robots).not.toContain("noindex");
    expect(head.canonical).toContain("/login");
    expect(head.description).toBeTruthy();

    for (const selector of [
      'meta[property="og:image"]',
      'meta[property="og:image:alt"]',
      'meta[name="twitter:image"]',
      'meta[property="og:title"]',
      'meta[property="og:url"]',
    ]) {
      await expect(page.locator(selector)).toHaveCount(1);
    }

    const ldJson = await page.locator('script[type="application/ld+json"]').textContent();
    const graph = (JSON.parse(ldJson ?? "{}") as { "@graph": { "@type": string }[] })["@graph"];
    expect(graph.map((node) => node["@type"])).toEqual(["WebSite", "WebApplication"]);
    for (const node of graph as unknown as { name: string; alternateName: string[] }[]) {
      expect(node.name).toBe("FraserPay");
      expect(node.alternateName).toContain("Fraser Pay");
    }
  });

  test("an unknown path renders the branded 404 with a single title and h1", async ({ page }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);

    await expect(page.locator("h1")).toHaveText("Page not found");
    await expect(page.locator("title")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Back to FraserPay" })).toBeVisible();
  });

  test("robots.txt, sitemap.xml and llms.txt are served without an auth redirect", async ({
    request,
  }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain("Allow: /login");
    expect(robotsBody).toContain("Allow: /$");
    expect(robotsBody).toContain("Disallow: /");
    expect(robotsBody).toContain("GPTBot");
    expect(robotsBody).toContain("Sitemap:");

    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("/login");

    const llms = await request.get("/llms.txt");
    expect(llms.status()).toBe(200);
    expect(await llms.text()).toContain("# FraserPay");
  });

  test("the opengraph image is reachable unauthenticated", async ({ request, page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    const src = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(src).toBeTruthy();

    const image = await request.get(src as string);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  });
});

test.describe("No production source maps", () => {
  test("client chunks ship without sourceMappingURL or a fetchable .map", async ({
    page,
    request,
  }) => {
    const scripts: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/_next/static/chunks/") && url.endsWith(".js")) scripts.push(url);
    });
    await page.goto("/wallet");
    expect(scripts.length).toBeGreaterThan(0);

    for (const url of scripts.slice(0, 5)) {
      const body = await (await request.get(url)).text();
      expect(body, `${url} must not reference a source map`).not.toContain("sourceMappingURL");
      expect((await request.get(`${url}.map`)).status()).toBe(404);
    }
  });
});
