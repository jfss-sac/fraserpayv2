import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { ReportsDTO } from "@/lib/shared/types";
import { ReportsView } from "./reports-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const DATA: ReportsDTO = {
  booths: [
    {
      boothId: "b1",
      boothName: "Ring Toss",
      status: "approved",
      grossCents: 4000,
      purchaseCount: 5,
      refundCount: 1,
      items: [{ itemId: "i1", name: "Play", qty: 8, revenueCents: 4000 }],
    },
    {
      boothId: "b2",
      boothName: "Old Booth",
      status: "deactivated",
      grossCents: 1500,
      purchaseCount: 3,
      refundCount: 0,
      items: [],
    },
  ],
  grossTotalCents: 5500,
  topups: { cashCents: 3000, cardCents: 2000, totalCents: 5000, count: 4 },
  outstandingLiabilityCents: 1200,
};

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

  test("expanding a booth reveals its item breakdown", async () => {
    render(<ReportsView data={DATA} />);

    const toggle = screen.getByRole("button", { name: /Ring Toss/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Play")).toBeInTheDocument();
  });

  test("marks a deactivated booth and still shows its historical gross", () => {
    render(<ReportsView data={DATA} />);
    const card = screen.getByRole("button", { name: /Old Booth/ }).closest("li")!;
    expect(within(card).getByText("Deactivated")).toBeInTheDocument();
    expect(within(card).getByText("$15.00")).toBeInTheDocument();
  });

  test("the refresh button triggers a router refresh", async () => {
    render(<ReportsView data={DATA} />);
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalled();
  });
});
