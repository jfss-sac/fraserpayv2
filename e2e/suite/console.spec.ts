import { type ConsoleMessage, type Page, expect, test } from "@playwright/test";
import { APPROVED_BOOTH_ID, BUYER_UID, OPERATOR_UID, SAC_MEMBER_STATE } from "../fixtures";
import { paymentCodeFor } from "../helpers/users";

const OPERATOR_ROUTES = [
  "/wallet",
  "/leaderboard",
  "/booths/join",
  "/booths/register",
  "/sell",
  `/sell/${APPROVED_BOOTH_ID}`,
  `/booth/${APPROVED_BOOTH_ID}`,
];

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

const SENSITIVE_PATTERNS: [string, RegExp][] = [
  ["session cookie", /__session/i],
  ["payment code", /fp1-[0-9A-HJKMNP-TV-Z]{6,}/i],
  ["firebase id token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ["service account key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["pdsb email", /[0-9]{5,}@pdsb\.net/i],
];

interface Captured {
  route: string;
  type: string;
  text: string;
}

async function collect(page: Page, routes: string[]): Promise<Captured[]> {
  const captured: Captured[] = [];
  let route = "";

  const onConsole = (msg: ConsoleMessage): void => {
    captured.push({ route, type: msg.type(), text: msg.text() });
  };
  const onPageError = (err: Error): void => {
    captured.push({ route, type: "pageerror", text: `${err.name}: ${err.message}` });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  for (const path of routes) {
    route = path;
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  return captured;
}

function describeAll(captured: Captured[]): string {
  return captured.map((c) => `${c.route} [${c.type}] ${c.text}`).join("\n");
}

function expectClean(captured: Captured[]): void {
  const failures = captured.filter((c) => c.type === "error" || c.type === "pageerror");
  expect(failures, describeAll(failures)).toEqual([]);

  for (const [label, pattern] of SENSITIVE_PATTERNS) {
    const leaks = captured.filter((c) => pattern.test(c.text));
    expect(leaks, `console output leaked a ${label}:\n${describeAll(leaks)}`).toEqual([]);
  }
}

test.describe("Browser console — student and booth routes", () => {
  test("logs no errors and leaks no credentials or student identifiers", async ({ page }) => {
    const captured = await collect(page, OPERATOR_ROUTES);
    expectClean(captured);

    expect(describeAll(captured)).not.toContain(paymentCodeFor(OPERATOR_UID));
  });
});

test.describe("Browser console — SAC routes", () => {
  test.use({ storageState: SAC_MEMBER_STATE });

  test("logs no errors and leaks no credentials or student identifiers", async ({ page }) => {
    expectClean(await collect(page, SAC_ROUTES));
  });
});

test.describe("Browser console — public surfaces", () => {
  test("the sign-in page and the 404 log nothing", async ({ page }) => {
    await page.context().clearCookies();
    expectClean(await collect(page, ["/login"]));
  });

  test("an unknown path logs nothing beyond the browser's own 404 notice", async ({ page }) => {
    const captured = await collect(page, ["/this-route-does-not-exist"]);
    expectClean(captured.filter((c) => !/Failed to load resource/.test(c.text)));
  });
});
