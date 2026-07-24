import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderPaymentQrSvg } from "@/lib/server/qr";
import { WalletView, type WalletHistoryItem } from "./wallet-view";

const QR = renderPaymentQrSvg("fp1-ABCDEFGHJKMNPQRSTVWXYZ0123");

const purchase: WalletHistoryItem = {
  id: "e-purchase",
  type: "purchase",
  direction: "debit",
  amountCents: 750,
  balanceAfterCents: 1250,
  createdAtIso: "2026-07-24T15:04:00.000Z",
  boothName: "Taco Stand",
  lineItems: [
    { itemId: "i1", name: "Taco", qty: 2, unitPriceCents: 250 },
    { itemId: "i2", name: "Custom", qty: 1, unitPriceCents: 250 },
  ],
};

const topup: WalletHistoryItem = {
  id: "e-topup",
  type: "topup",
  direction: "credit",
  amountCents: 2000,
  balanceAfterCents: 2000,
  createdAtIso: "2026-07-24T14:00:00.000Z",
  method: "cash",
};

function baseProps(history: WalletHistoryItem[] = []) {
  return {
    qrSvg: QR,
    studentNumber: "800123",
    balanceCents: 1250,
    points: 100,
    asOfIso: "2026-07-24T15:05:00.000Z",
    history,
  };
}

test("renders the QR SVG, balance, points, and student number", () => {
  const { container } = render(<WalletView {...baseProps()} />);
  const svg = container.querySelector("svg");
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute("role")).toBe("img");
  expect(screen.getByText("$12.50")).toBeInTheDocument();
  expect(screen.getByText("100")).toBeInTheDocument();
  expect(screen.getByText("#800123")).toBeInTheDocument();
});

test("omits the student number row for teacher-pattern accounts", () => {
  render(<WalletView {...baseProps()} studentNumber={null} />);
  expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
});

test("itemizes a purchase with booth, quantities, unit prices, and amounts (FR-10c)", () => {
  render(<WalletView {...baseProps([purchase])} />);
  const row = screen.getByText("Taco Stand").closest("li") as HTMLElement;
  expect(within(row).getByText("-$7.50")).toBeInTheDocument();
  expect(within(row).getByText("Taco × 2 @ $2.50")).toBeInTheDocument();
  expect(within(row).getByText("Custom × 1 @ $2.50")).toBeInTheDocument();
  expect(within(row).getByText("$5.00")).toBeInTheDocument();
  expect(within(row).getByText("Balance $12.50")).toBeInTheDocument();
});

test("shows credits with a plus sign and a top-up method", () => {
  render(<WalletView {...baseProps([topup])} />);
  const row = screen.getByText("Top-up · Cash").closest("li") as HTMLElement;
  expect(within(row).getByText("+$20.00")).toBeInTheDocument();
});

test("renders an empty-state message when there is no history", () => {
  render(<WalletView {...baseProps([])} />);
  expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
});

test("stamps the as-of time as a machine-readable time element", () => {
  render(<WalletView {...baseProps()} />);
  const stamp = document.querySelector('time[datetime="2026-07-24T15:05:00.000Z"]');
  expect(stamp).not.toBeNull();
});

test("history itemization structure snapshot", () => {
  const { container } = render(<WalletView {...baseProps([purchase, topup])} />);
  expect(container.querySelector("section:last-of-type > ul")).toMatchSnapshot();
});
