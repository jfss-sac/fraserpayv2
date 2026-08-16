import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    repeatBuyersTruncated: false,
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

test("preset chips send the selected time range and can clear it", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
    const fetchMock = stubFetch(() => ({
      entries: [ledger("filtered")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    }));

    render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} pollMs={60_000} />);

    fireEvent.click(screen.getByRole("button", { name: "Last 15 min" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const presetUrl = new URL(fetchMock.mock.calls[0]![0] as string, "http://test");
    expect(presetUrl.searchParams.get("from")).toBe("2026-08-16T11:45:00.000Z");
    expect(presetUrl.searchParams.get("to")).toBe("2026-08-16T12:00:00.000Z");
    expect(screen.getByRole("button", { name: /Clear time range Last 15 min/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Clear time range Last 15 min/ }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const clearedUrl = new URL(fetchMock.mock.calls[1]![0] as string, "http://test");
    expect(clearedUrl.searchParams.has("from")).toBe(false);
    expect(clearedUrl.searchParams.has("to")).toBe(false);
    expect(screen.queryByRole("button", { name: /Clear time range/ })).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("custom absolute range sends normalized instants", async () => {
  const fetchMock = stubFetch(() => ({
    entries: [ledger("filtered")],
    nextCursor: null,
    repeatBuyers: [],
    repeatBuyersTruncated: false,
  }));

  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} pollMs={60_000} />);

  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-08-16T10:00" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-08-16T11:00" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Apply custom range" }));

  expect(await screen.findByRole("button", { name: /Clear time range Custom/ })).toBeVisible();
  const url = new URL(fetchMock.mock.calls[0]![0] as string, "http://test");
  expect(url.searchParams.get("from")).toBe("2026-08-16T10:00:00.000Z");
  expect(url.searchParams.get("to")).toBe("2026-08-16T11:00:00.000Z");
});

test("clicking a SAC member filters the feed to that actor and shows a removable pill", async () => {
  const fetchMock = stubFetch((url) => {
    expect(url.searchParams.get("actorUid")).toBe("a1");
    return {
      entries: [ledger("only")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    };
  });

  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} />);

  await userEvent.click(screen.getByRole("button", { name: "Ada Actor" }));

  expect(await screen.findByRole("button", { name: /Clear filter By · Ada Actor/ })).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("shows the auto-refresh affordance and a manual refresh control", () => {
  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} />);
  expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  expect(screen.getByText(/Auto-refreshes every 5 min/)).toBeInTheDocument();
});

test("renders an empty state when there are no entries", () => {
  render(<FeedView initialEntries={[]} initialCursor={null} />);
  expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
});

test("banners a repeat-charged buyer by name and charge count", () => {
  render(
    <FeedView
      initialEntries={[ledger("p1")]}
      initialCursor={null}
      initialRepeatBuyers={[
        { studentUid: "s1", studentName: "Rita Repeat", charges: 12 },
        { studentUid: "s2", studentName: "Sam Second", charges: 10 },
      ]}
    />,
  );

  const banner = screen.getByRole("region", { name: "Repeat charge alerts" });
  expect(within(banner).getByText(/Charged unusually often in the last 10 minutes/)).toBeVisible();
  expect(within(banner).getByText("Rita Repeat — 12 charges")).toBeVisible();
  expect(within(banner).getByText("Sam Second — 10 charges")).toBeVisible();
});

test("shows no repeat-charge banner when nobody is flagged and the scan was complete", () => {
  render(
    <FeedView initialEntries={[ledger("p1")]} initialCursor={null} initialRepeatBuyers={[]} />,
  );
  expect(screen.queryByRole("region", { name: "Repeat charge alerts" })).not.toBeInTheDocument();
});

test("clears the repeat-charge banner when a refresh finds nobody flagged", async () => {
  stubFetch(() => ({
    entries: [ledger("p1")],
    nextCursor: null,
    repeatBuyers: [],
    repeatBuyersTruncated: false,
  }));

  render(
    <FeedView
      initialEntries={[ledger("p1")]}
      initialCursor={null}
      initialRepeatBuyers={[{ studentUid: "s1", studentName: "Rita Repeat", charges: 12 }]}
    />,
  );

  expect(screen.getByText("Rita Repeat — 12 charges")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

  await vi.waitFor(() => {
    expect(screen.queryByRole("region", { name: "Repeat charge alerts" })).not.toBeInTheDocument();
  });
});

test("warns that the repeat-charge scan hit its cap rather than implying nobody was flagged", () => {
  render(
    <FeedView
      initialEntries={[ledger("p1")]}
      initialCursor={null}
      initialRepeatBuyers={[]}
      initialRepeatBuyersTruncated
    />,
  );

  const banner = screen.getByRole("region", { name: "Repeat charge alerts" });
  expect(within(banner).getByText(/a repeat buyer may be missing/)).toBeVisible();
});

test("surfaces a repeat-charge truncation warning raised by a later refresh", async () => {
  stubFetch(() => ({
    entries: [ledger("p1")],
    nextCursor: null,
    repeatBuyers: [],
    repeatBuyersTruncated: true,
  }));

  render(
    <FeedView initialEntries={[ledger("p1")]} initialCursor={null} initialRepeatBuyers={[]} />,
  );
  expect(screen.queryByRole("region", { name: "Repeat charge alerts" })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

  expect(await screen.findByText(/a repeat buyer may be missing/)).toBeVisible();
});

test("labels a burst's new-transaction count as a lower bound", async () => {
  vi.useFakeTimers();
  try {
    stubFetch(() => ({
      entries: Array.from({ length: 25 }, (_, i) => ledger(`n${i + 1}`)),
      nextCursor: "head",
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    }));

    render(<FeedView initialEntries={[ledger("p1")]} initialCursor="deep" pollMs={1000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByRole("button", { name: "25+ new transactions — show" })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});

test("offers load-older only while a cursor remains", () => {
  render(<FeedView initialEntries={[ledger("p1")]} initialCursor="c1" />);
  expect(screen.getByRole("button", { name: "Load older" })).toBeInTheDocument();

  cleanup();
  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} />);
  expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
});

test("attaches infinite scrolling when a filter response introduces a cursor", async () => {
  let intersectionCallback: IntersectionObserverCallback | undefined;
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = observe;
      disconnect = disconnect;
    },
  );
  const fetchMock = stubFetch((url) => ({
    entries: [ledger(url.searchParams.has("cursor") ? "older" : "filtered")],
    nextCursor: url.searchParams.has("cursor") ? null : "c1",
    repeatBuyers: [],
    repeatBuyersTruncated: false,
  }));

  render(<FeedView initialEntries={[ledger("p1")]} initialCursor={null} />);
  expect(observe).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Top-ups" }));
  expect(await screen.findByRole("button", { name: "Load older" })).toBeVisible();
  await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(1));

  act(() => {
    intersectionCallback?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const olderUrl = new URL(fetchMock.mock.calls[1]![0] as string, "http://test");
  expect(olderUrl.searchParams.get("cursor")).toBe("c1");
});
