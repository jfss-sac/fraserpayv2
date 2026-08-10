import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { FeedAuditEntry, FeedDTO, FeedLedgerEntry } from "@/lib/shared/types";
import { FeedView } from "./feed-view";

function ledger(id: string, overrides: Partial<FeedLedgerEntry> = {}): FeedLedgerEntry {
  return {
    kind: "ledger",
    id,
    createdAt: "2026-07-26T12:00:00.000Z",
    type: "purchase",
    direction: "debit",
    amountCents: 300,
    balanceAfterCents: 1700,
    studentUid: "s1",
    studentNumber: "700001",
    studentName: "Stu Dent",
    actorUid: "a1",
    actorName: "Ada Actor",
    tags: [],
    ...overrides,
  };
}

function audit(id: string, overrides: Partial<FeedAuditEntry> = {}): FeedAuditEntry {
  return {
    kind: "audit",
    id,
    createdAt: "2026-07-26T12:00:00.000Z",
    action: "user.suspend",
    actorUid: "x1",
    actorName: "Xavi Exec",
    targetType: "user",
    targetId: "u9",
    targetLabel: "Some Student",
    details: {},
    ...overrides,
  };
}

function stubFetch(responder: (url: URL) => FeedDTO) {
  const fetchMock = vi.fn(async (url: string) => {
    return { ok: true, json: async () => responder(new URL(url, "http://test")) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("visually flags high-amount rows and labels them", () => {
  render(
    <FeedView
      initialEntries={[
        ledger("hi", { amountCents: 2000, tags: ["high-amount"], boothName: "Pizza Palace" }),
      ]}
      initialCursor={null}
    />,
  );

  const list = screen.getByRole("list", { name: "Transactions" });
  expect(within(list).getByText("High amount")).toBeInTheDocument();
  expect(screen.getByText("Pizza Palace")).toBeInTheDocument();
});

test("renders both ledger and audit entries", () => {
  render(
    <FeedView
      initialEntries={[ledger("l1", { boothName: "Pizza Palace" }), audit("a1")]}
      initialCursor={null}
    />,
  );

  expect(screen.getByText("Pizza Palace")).toBeInTheDocument();
  expect(screen.getByText("Suspended account")).toBeInTheDocument();
  expect(screen.getByText("Some Student")).toBeInTheDocument();
});

test("expands a row to reveal its line items", async () => {
  render(
    <FeedView
      initialEntries={[
        ledger("l1", {
          boothName: "Pizza Palace",
          lineItems: [{ itemId: "i1", name: "Slice", qty: 2, unitPriceCents: 150 }],
        }),
      ]}
      initialCursor={null}
    />,
  );

  expect(screen.queryByText(/Slice × 2/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show details" }));
  expect(screen.getByText(/Slice × 2/)).toBeInTheDocument();
});

test("selecting a type chip refetches with that filter", async () => {
  const fetchMock = stubFetch(() => ({
    entries: [ledger("t1", { type: "topup", method: "cash", direction: "credit" })],
    nextCursor: null,
    repeatBuyers: [],
  }));

  render(
    <FeedView
      initialEntries={[ledger("p1", { boothName: "Pizza Palace" })]}
      initialCursor={null}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Top-ups" }));

  expect(await screen.findByText("Top-up · Cash")).toBeInTheDocument();
  const url = new URL(fetchMock.mock.calls[0]![0] as string, "http://test");
  expect(url.searchParams.get("type")).toBe("topup");
});

test("clicking a SAC member filters the feed to that actor and shows a removable pill", async () => {
  const fetchMock = stubFetch((url) => {
    expect(url.searchParams.get("actorUid")).toBe("a1");
    return { entries: [ledger("only")], nextCursor: null, repeatBuyers: [] };
  });

  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} />);

  await userEvent.click(screen.getByRole("button", { name: "Ada Actor" }));

  expect(await screen.findByRole("button", { name: /Clear filter By · Ada Actor/ })).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("shows the auto-refresh affordance and a manual refresh control", () => {
  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} />);
  expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  expect(screen.getByText(/Auto-refreshes every 60s/)).toBeInTheDocument();
});

test("renders an empty state when there are no entries", () => {
  render(<FeedView initialEntries={[]} initialCursor={null} />);
  expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
});

test("offers load-older only while a cursor remains", () => {
  render(<FeedView initialEntries={[ledger("p1")]} initialCursor="c1" />);
  expect(screen.getByRole("button", { name: "Load older" })).toBeInTheDocument();

  cleanup();
  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} />);
  expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
});
