import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { getSession, getFeed, getCachedAdminKpis, notFound } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getFeed: vi.fn(),
  getCachedAdminKpis: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession }));
vi.mock("@/lib/server/sac-feed", () => ({ getFeed }));
vi.mock("@/lib/server/sac-reports", () => ({ getCachedAdminKpis }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("./feed-view", () => ({
  FeedView: ({ initialEntries }: { initialEntries: unknown[] }) => (
    <div data-testid="feed">{initialEntries.length} feed entries</div>
  ),
}));

import FeedPage from "./page";

const FEED = {
  entries: [{ id: "entry-1" }],
  nextCursor: null,
  repeatBuyers: [],
  repeatBuyersTruncated: false,
};

const KPIS = {
  transactionsToday: 12,
  activeBooths: 4,
  accounts: 86,
  grossRevenueCents: 3_800,
};

beforeEach(() => {
  getSession.mockReset();
  getFeed.mockReset();
  getCachedAdminKpis.mockReset();
  notFound.mockClear();
  getSession.mockResolvedValue({
    uid: "member-1",
    suspended: false,
    roles: { sacMember: true, sacExec: false },
  });
  getFeed.mockResolvedValue(FEED);
  getCachedAdminKpis.mockResolvedValue(KPIS);
});

test("renders the cached KPI strip above the feed", async () => {
  render(await FeedPage());

  expect(screen.getByRole("region", { name: "Admin summary" })).toBeInTheDocument();
  expect(screen.getByText("Transactions today").parentElement).toHaveTextContent("12");
  expect(screen.getByText("Active booths").parentElement).toHaveTextContent("4");
  expect(screen.getByText("Accounts").parentElement).toHaveTextContent("86");
  expect(screen.getByText("Gross revenue").parentElement).toHaveTextContent("$38.00");
  expect(screen.getByTestId("feed")).toHaveTextContent("1 feed entries");
});

test("keeps the feed when the KPI aggregation fails", async () => {
  getCachedAdminKpis.mockRejectedValue(new Error("aggregation unavailable"));

  render(await FeedPage());

  expect(screen.queryByRole("region", { name: "Admin summary" })).not.toBeInTheDocument();
  expect(screen.getByTestId("feed")).toHaveTextContent("1 feed entries");
});
