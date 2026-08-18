import { render as testingRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { BoothHistoryDTO, BoothHistoryEntry } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { requestBoothHistory } from "@/lib/ui/booth-history-api";
import { BoothHistoryView } from "@/lib/ui/booth-history-view";
import { ToastProvider } from "@/lib/ui/toast";

vi.mock("@/lib/ui/booth-history-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ui/booth-history-api")>();
  return { ...actual, requestBoothHistory: vi.fn() };
});

const mockRequest = vi.mocked(requestBoothHistory);

function entry(entryId: string, overrides: Partial<BoothHistoryEntry> = {}): BoothHistoryEntry {
  return {
    entryId,
    createdAt: "2026-08-15T18:00:00.000Z",
    type: "purchase",
    amountCents: 750,
    direction: "debit",
    buyerName: "Stu Dent",
    lineItems: [
      { itemId: "slice", name: "Slice", qty: 2, unitPriceCents: 300 },
      { itemId: "pop", name: "Pop", qty: 1, unitPriceCents: 150 },
    ],
    actorName: "Ada Actor",
    ...overrides,
  };
}

function pageOf(entries: BoothHistoryEntry[], nextCursor: string | null = null): BoothHistoryDTO {
  return { entries, nextCursor };
}

function render(
  props: { requestHistory?: typeof requestBoothHistory; showScopeToggle?: boolean } = {},
) {
  return testingRender(<BoothHistoryView boothId="booth-1" {...props} />, {
    wrapper: ToastProvider,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

test("shows a skeleton while the first page is in flight", async () => {
  mockRequest.mockReturnValueOnce(new Promise<BoothHistoryDTO>(() => {}));

  render();

  expect(screen.getByRole("status", { name: "Loading sales" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Sales" })).not.toBeInTheDocument();
});

test("renders a sale as time, buyer, line items, amount and operator", async () => {
  mockRequest.mockResolvedValueOnce(pageOf([entry("e1")]));

  render();

  const list = await screen.findByRole("list", { name: "Sales" });
  expect(within(list).getByText("Stu Dent")).toBeInTheDocument();
  expect(within(list).getByText("Slice × 2 @ $3.00")).toBeInTheDocument();
  expect(within(list).getByText("$7.50")).toBeInTheDocument();
  expect(within(list).getByText("by Ada Actor")).toBeInTheDocument();
  expect(list.querySelector("time")).toHaveAttribute("datetime", "2026-08-15T18:00:00.000Z");
});

test("shows a refund as a reversal of its purchase", async () => {
  mockRequest.mockResolvedValueOnce(
    pageOf([
      entry("r1", { type: "refund", direction: "credit", originalEntryId: "e1" }),
      entry("e1"),
    ]),
  );

  render();

  const list = await screen.findByRole("list", { name: "Sales" });
  expect(within(list).getByText("Refund")).toBeInTheDocument();
  expect(within(list).getByText("-$7.50")).toBeInTheDocument();
  expect(within(list).getByText("$7.50")).toBeInTheDocument();
});

test("says so when the booth has not sold anything yet", async () => {
  mockRequest.mockResolvedValueOnce(pageOf([]));

  render();

  expect(await screen.findByText("No sales yet.")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Sales" })).not.toBeInTheDocument();
});

test("offers a retry and a non-blocking toast when the load fails", async () => {
  mockRequest.mockRejectedValueOnce(new ApiError("RATE_LIMITED"));

  render();

  const retry = await screen.findByRole("button", { name: "Try again" });
  expect(within(screen.getByRole("status")).getByText(/too many refreshes/i)).toBeInTheDocument();
  expect(within(screen.getByRole("alert")).getByText(/too many refreshes/i)).toBeInTheDocument();
  expect(screen.queryByText("No sales yet.")).not.toBeInTheDocument();

  mockRequest.mockResolvedValueOnce(pageOf([entry("e1")]));
  await userEvent.click(retry);

  expect(await screen.findByRole("list", { name: "Sales" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("keeps the list on screen while a refresh is in flight, then replaces it", async () => {
  mockRequest.mockResolvedValueOnce(pageOf([entry("e1", { buyerName: "First Buyer" })]));
  render();
  await screen.findByText("First Buyer");

  let resolveRefresh!: (dto: BoothHistoryDTO) => void;
  mockRequest.mockReturnValueOnce(
    new Promise<BoothHistoryDTO>((resolve) => {
      resolveRefresh = resolve;
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

  expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  expect(screen.getByText("First Buyer")).toBeInTheDocument();

  resolveRefresh(pageOf([entry("e2", { buyerName: "Later Buyer" })]));

  expect(await screen.findByText("Later Buyer")).toBeInTheDocument();
  expect(screen.queryByText("First Buyer")).not.toBeInTheDocument();
});

test("re-fetches from the head when the operator asks for their own sales", async () => {
  mockRequest.mockResolvedValueOnce(pageOf([entry("e1", { actorName: "Ada Actor" })]));
  render();
  await screen.findByRole("list", { name: "Sales" });

  mockRequest.mockResolvedValueOnce(pageOf([entry("e2", { actorName: "Bo Booth" })]));
  await userEvent.click(screen.getByRole("button", { name: "Just mine" }));

  await waitFor(() => expect(screen.getByText("by Bo Booth")).toBeInTheDocument());
  expect(mockRequest).toHaveBeenLastCalledWith("booth-1", { mine: true });
  expect(screen.getByRole("button", { name: "Just mine" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByText("by Ada Actor")).not.toBeInTheDocument();
});

test("can hide the scope toggle for an all-history reader", async () => {
  mockRequest.mockResolvedValueOnce(pageOf([]));

  render({ requestHistory: mockRequest, showScopeToggle: false });

  expect(await screen.findByText("No sales yet.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Filter sales" })).not.toBeInTheDocument();
  expect(mockRequest).toHaveBeenCalledWith("booth-1", {});
});

test("appends the next page when the operator loads older sales", async () => {
  mockRequest.mockResolvedValueOnce(pageOf([entry("e2", { buyerName: "Newer Buyer" })], "e2"));
  render();
  await screen.findByText("Newer Buyer");

  mockRequest.mockResolvedValueOnce(pageOf([entry("e1", { buyerName: "Older Buyer" })]));
  await userEvent.click(screen.getByRole("button", { name: "Load older" }));

  expect(await screen.findByText("Older Buyer")).toBeInTheDocument();
  expect(screen.getByText("Newer Buyer")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
});
