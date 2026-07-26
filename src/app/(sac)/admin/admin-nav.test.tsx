import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AdminNav } from "./admin-nav";
import { ADMIN_NAV, visibleNav, type AdminNavItem } from "./nav";

const nav = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const MEMBER = { sacMember: true, sacExec: false };

beforeEach(() => {
  nav.pathname = "/admin";
});

test("renders a link for every visible section", () => {
  render(<AdminNav items={ADMIN_NAV} />);
  for (const item of ADMIN_NAV) {
    expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
  }
});

test("marks the current section active and leaves the others unmarked", () => {
  nav.pathname = "/admin/topup";
  render(<AdminNav items={ADMIN_NAV} />);
  expect(screen.getByRole("link", { name: "Top-up" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Students" })).not.toHaveAttribute("aria-current");
});

test("Feed is active only on the /admin index, not on nested sections", () => {
  nav.pathname = "/admin/topup";
  render(<AdminNav items={ADMIN_NAV} />);
  expect(screen.getByRole("link", { name: "Feed" })).not.toHaveAttribute("aria-current");
});

test("a nested detail route keeps its parent section active", () => {
  nav.pathname = "/admin/students/abc123";
  render(<AdminNav items={ADMIN_NAV} />);
  expect(screen.getByRole("link", { name: "Students" })).toHaveAttribute("aria-current", "page");
});

test("renders only the items it is given — a member never sees an exec-only link", () => {
  const withExec: AdminNavItem[] = [
    ...ADMIN_NAV,
    { href: "/admin/x", label: "Danger", exec: true },
  ];
  render(<AdminNav items={visibleNav(withExec, MEMBER)} />);
  expect(screen.queryByRole("link", { name: "Danger" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Feed" })).toBeInTheDocument();
});
