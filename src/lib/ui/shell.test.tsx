import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AppShell, buildModes, type Mode } from "@/lib/ui/shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const STUDENT = { sacMember: false, sacExec: false };
const MEMBER = { sacMember: true, sacExec: false };
const EXEC = { sacMember: false, sacExec: true };

test("buildModes: a plain student holds only the student mode", () => {
  expect(buildModes(STUDENT, false)).toEqual(["student"]);
});

test("buildModes: booth membership adds the sell mode", () => {
  expect(buildModes(STUDENT, true)).toEqual(["student", "sell"]);
});

test("buildModes: a SAC member adds the admin mode", () => {
  expect(buildModes(MEMBER, false)).toEqual(["student", "admin"]);
});

test("buildModes: a SAC exec adds the admin mode", () => {
  expect(buildModes(EXEC, false)).toEqual(["student", "admin"]);
});

test("buildModes: a booth-member SAC exec holds all three modes in order", () => {
  expect(buildModes(EXEC, true)).toEqual(["student", "sell", "admin"]);
});

function renderShell(modes: Mode[], active: Mode, suspended = false) {
  render(
    <AppShell active={active} modes={modes} suspended={suspended}>
      <p>page body</p>
    </AppShell>,
  );
}

test("shell shows only the modes the user holds", () => {
  renderShell(["student"], "student");
  expect(screen.getByRole("link", { name: "Wallet" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sell" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
});

test("shell shows the admin nav for a SAC member", () => {
  renderShell(["student", "admin"], "admin");
  expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Sell" })).not.toBeInTheDocument();
});

test("shell shows all three modes and points each to its route", () => {
  renderShell(["student", "sell", "admin"], "sell");
  expect(screen.getByRole("link", { name: "Wallet" })).toHaveAttribute("href", "/wallet");
  expect(screen.getByRole("link", { name: "Sell" })).toHaveAttribute("href", "/sell");
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
});

test("shell marks the active mode with aria-current", () => {
  renderShell(["student", "sell", "admin"], "admin");
  expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Wallet" })).not.toHaveAttribute("aria-current");
});

test("shell always offers a sign-out control", () => {
  renderShell(["student"], "student");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

test("shell hides the suspended banner by default", () => {
  renderShell(["student"], "student");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shell surfaces the suspended banner when the account is suspended", () => {
  renderShell(["student"], "student", true);
  expect(screen.getByRole("alert")).toHaveTextContent(/suspended — see SAC/i);
});
