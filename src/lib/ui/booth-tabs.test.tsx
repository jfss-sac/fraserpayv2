import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { BoothTabs, type BoothTab } from "@/lib/ui/booth-tabs";

vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: {
    href: string;
    prefetch?: boolean;
    children: React.ReactNode;
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));

const LABELS = ["Dashboard", "Sell", "History", "Settings"];

function renderTabs(active: BoothTab, isMember = true) {
  render(<BoothTabs boothId="booth-1" active={active} isMember={isMember} />);
}

test("a member gets all four tabs, each pointing at its route", () => {
  renderTabs("dashboard");
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/booth/booth-1");
  expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/sell/booth-1");
  expect(screen.getByRole("link", { name: "History" })).toHaveAttribute(
    "href",
    "/booth/booth-1/history",
  );
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/booth/booth-1/settings",
  );
});

test.each([
  ["dashboard", "Dashboard"],
  ["sell", "Sell"],
  ["history", "History"],
  ["settings", "Settings"],
] as const)("marks %s as the current tab and no other", (active, label) => {
  renderTabs(active);
  for (const other of LABELS) {
    const link = screen.getByRole("link", { name: other });
    if (other === label) expect(link).toHaveAttribute("aria-current", "page");
    else expect(link).not.toHaveAttribute("aria-current");
  }
});

test("a non-member exec sees the Sell tab alone — the other three would be dead links", () => {
  renderTabs("sell", false);
  expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/sell/booth-1");
  for (const gone of ["Dashboard", "History", "Settings"]) {
    expect(screen.queryByRole("link", { name: gone })).not.toBeInTheDocument();
  }
});

test("a non-member exec's way back is the admin booth page they came from", () => {
  renderTabs("sell", false);
  expect(screen.getByRole("link", { name: "Booth admin" })).toHaveAttribute(
    "href",
    "/admin/booths/booth-1",
  );
});

test("a member gets no admin back-link — the app shell already offers the picker", () => {
  renderTabs("sell");
  expect(screen.queryByRole("link", { name: "Booth admin" })).not.toBeInTheDocument();
});

test("the tabs are one labelled navigation landmark", () => {
  renderTabs("dashboard");
  expect(screen.getByRole("navigation", { name: "Booth sections" })).toBeInTheDocument();
});

test("no tab prefetches — chrome on every booth page must not spend the POS route's transfer", () => {
  renderTabs("sell", false);
  for (const link of screen.getAllByRole("link")) {
    expect(link).toHaveAttribute("data-prefetch", "false");
  }
});

test("every tab clears the 44 px minimum touch target (NFR-16)", () => {
  renderTabs("dashboard", false);
  for (const link of screen.getAllByRole("link")) {
    expect(link.className).toContain("min-h-11");
  }
});
