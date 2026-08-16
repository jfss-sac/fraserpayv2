import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { getSession, isBoothMember, notFound, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  isBoothMember: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession, isBoothMember }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("./history-view", () => ({
  BoothHistoryView: ({ boothId }: { boothId: string }) => <div>history view for {boothId}</div>,
}));

import BoothHistoryPage from "./page";

function page() {
  return BoothHistoryPage({ params: Promise.resolve({ boothId: "booth-1" }) });
}

beforeEach(() => {
  getSession.mockReset();
  isBoothMember.mockReset();
  notFound.mockClear();
  redirect.mockClear();
});

test("shows the history list to a member of the booth, with the history tab current", async () => {
  getSession.mockResolvedValue({ uid: "seller-1", roles: { sacMember: false, sacExec: false } });
  isBoothMember.mockResolvedValue(true);

  render(await page());

  expect(screen.getByText("history view for booth-1")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/booth/booth-1");
});

test("turns away an exec who is not a member — the history tab stays member-only", async () => {
  getSession.mockResolvedValue({ uid: "exec-1", roles: { sacMember: true, sacExec: true } });
  isBoothMember.mockResolvedValue(false);

  await expect(page()).rejects.toThrow("NOT_FOUND");
  expect(notFound).toHaveBeenCalled();
});

test("sends a signed-out visitor to the login page", async () => {
  getSession.mockResolvedValue(null);

  await expect(page()).rejects.toThrow("REDIRECT:/login");
  expect(isBoothMember).not.toHaveBeenCalled();
});
