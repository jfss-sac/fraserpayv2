import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReportsDTO } from "@/lib/shared/types";
import { ReportsView } from "./reports-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const refreshEventReports = vi.fn();
vi.mock("./actions", () => ({ refreshEventReports: () => refreshEventReports() }));

const DATA: ReportsDTO = {
  booths: [
    {
      boothId: "b1",
      boothName: "Ring Toss",
      status: "approved",
      grossCents: 4000,
      purchaseCount: 5,
      refundCount: 1,
    },
    {
      boothId: "b2",
      boothName: "Old Booth",
      status: "deactivated",
      grossCents: 1500,
      purchaseCount: 3,
      refundCount: 0,
    },
  ],
  grossTotalCents: 5500,
  topups: { cashCents: 3000, cardCents: 2000, totalCents: 5000, count: 4 },
  outstandingLiabilityCents: 1200,
};

function mockSummaryFetch(items: unknown[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ items }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  refresh.mockReset();
  refreshEventReports.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReportsView", () => {
  test("renders the payout, top-up split and liability totals", () => {
    render(<ReportsView data={DATA} />);

    expect(
      within(screen.getByText("Gross sales").closest("div")!).getByText("$55.00"),
    ).toBeInTheDocument();
    expect(screen.getByText("$30.00 cash / $20.00 card")).toBeInTheDocument();
    expect(
      within(screen.getByText("Outstanding liability").closest("div")!).getByText("$12.00"),
    ).toBeInTheDocument();
  });

  test("offers a report CSV download", () => {
    render(<ReportsView data={DATA} />);

    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/api/sac/reports/export",
    );
  });

  test("shows the itemized ledger control only for an exec", () => {
    const { rerender } = render(<ReportsView data={DATA} />);
    expect(screen.queryByText("Itemized ledger export")).toBeNull();

    rerender(<ReportsView data={DATA} canExportLedger />);
    expect(screen.getByText("Itemized ledger export")).toBeInTheDocument();
  });

  test("fetches the item breakdown only when a booth is expanded", async () => {
    const fetchMock = mockSummaryFetch([
      { itemId: "i1", name: "Play", qty: 8, revenueCents: 4000 },
    ]);
    render(<ReportsView data={DATA} />);

    expect(fetchMock).not.toHaveBeenCalled();

    const toggle = screen.getByRole("button", { name: /Ring Toss/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(fetchMock).toHaveBeenCalledWith("/api/sac/booths/b1/summary");
    expect(await screen.findByText("Play")).toBeInTheDocument();
  });

  test("does not re-fetch a breakdown it already loaded", async () => {
    const fetchMock = mockSummaryFetch([
      { itemId: "i1", name: "Play", qty: 8, revenueCents: 4000 },
    ]);
    render(<ReportsView data={DATA} />);

    const toggle = screen.getByRole("button", { name: /Ring Toss/ });
    await userEvent.click(toggle);
    expect(await screen.findByText("Play")).toBeInTheDocument();
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("offers a retry when the breakdown fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    render(<ReportsView data={DATA} />);

    await userEvent.click(screen.getByRole("button", { name: /Ring Toss/ }));

    expect(await screen.findByText(/Couldn't load the item breakdown/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  test("marks a deactivated booth and still shows its historical gross", () => {
    render(<ReportsView data={DATA} />);
    const card = screen.getByRole("button", { name: /Old Booth/ }).closest("li")!;
    expect(within(card).getByText("Deactivated")).toBeInTheDocument();
    expect(within(card).getByText("$15.00")).toBeInTheDocument();
  });

  test("the refresh button busts the reports cache before re-rendering", async () => {
    render(<ReportsView data={DATA} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refreshEventReports).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});
