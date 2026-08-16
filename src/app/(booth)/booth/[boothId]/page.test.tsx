import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { BoothSummary } from "@/lib/shared/types";

const { getSession, isBoothMember, getBoothSummary, notFound, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  isBoothMember: vi.fn(),
  getBoothSummary: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession, isBoothMember, getBoothSummary }));
vi.mock("next/navigation", () => ({ notFound, redirect }));

import BoothSummaryPage from "./page";

const SUMMARY: BoothSummary = {
  boothId: "booth-1",
  boothName: "Pizza Palace",
  status: "approved",
  grossCents: 1200,
  purchaseCount: 3,
  refundCount: 0,
  items: [{ itemId: "slice", name: "Slice", qty: 4, revenueCents: 1200 }],
};

function page() {
  return BoothSummaryPage({ params: Promise.resolve({ boothId: "booth-1" }) });
}

beforeEach(() => {
  getSession.mockReset();
  isBoothMember.mockReset();
  getBoothSummary.mockReset();
  getBoothSummary.mockResolvedValue(SUMMARY);
  notFound.mockClear();
  redirect.mockClear();
});

test("shows the totals to a member of the booth", async () => {
  getSession.mockResolvedValue({ uid: "seller-1", roles: { sacMember: false, sacExec: false } });
  isBoothMember.mockResolvedValue(true);
  render(await page());
  expect(screen.getByText("Pizza Palace")).toBeInTheDocument();
  expect(screen.getByText("Gross sales").parentElement).toHaveTextContent("$12.00");
});

test("turns away an exec who is not a member — seller tabs stay member-only", async () => {
  getSession.mockResolvedValue({ uid: "exec-1", roles: { sacMember: true, sacExec: true } });
  isBoothMember.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("NOT_FOUND");
  expect(getBoothSummary).not.toHaveBeenCalled();
});
