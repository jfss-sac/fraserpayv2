import { describe, expect, test } from "vitest";
import { ADMIN_NAV, visibleNav, type AdminNavItem } from "./nav";

const MEMBER = { sacMember: true, sacExec: false };
const EXEC = { sacMember: false, sacExec: true };

describe("ADMIN_NAV config (arch §7)", () => {
  test("lists the six admin sections in roadmap order", () => {
    expect(ADMIN_NAV.map((i) => i.label)).toEqual([
      "Feed",
      "Top-up",
      "Students",
      "Booths",
      "Reports",
      "Reconciliation",
    ]);
  });

  test("Feed is the /admin index and every section routes under /admin", () => {
    expect(ADMIN_NAV.find((i) => i.label === "Feed")?.href).toBe("/admin");
    for (const item of ADMIN_NAV) expect(item.href.startsWith("/admin")).toBe(true);
  });

  test("every shipped section is member-visible (exec gating is in-page per arch §7)", () => {
    expect(ADMIN_NAV.every((i) => !i.exec)).toBe(true);
    expect(visibleNav(ADMIN_NAV, MEMBER)).toEqual([...ADMIN_NAV]);
    expect(visibleNav(ADMIN_NAV, EXEC)).toEqual([...ADMIN_NAV]);
  });
});

describe("visibleNav capability filter", () => {
  const items: AdminNavItem[] = [
    { href: "/admin", label: "Feed" },
    { href: "/admin/danger", label: "Danger", exec: true },
  ];

  test("hides exec-only items from a member", () => {
    expect(visibleNav(items, MEMBER).map((i) => i.label)).toEqual(["Feed"]);
  });

  test("shows exec-only items to an exec", () => {
    expect(visibleNav(items, EXEC).map((i) => i.label)).toEqual(["Feed", "Danger"]);
  });

  test("preserves the declared order of visible items", () => {
    expect(visibleNav(items, EXEC).map((i) => i.href)).toEqual(["/admin", "/admin/danger"]);
  });
});
