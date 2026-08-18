import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FeedAuditEntry, FeedDTO, FeedLedgerEntry } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { requestFeed } from "./api";
import type { FeedTimeRange } from "./feed-time-range";
import { FEED_POLL_MS, useFeed } from "./use-feed";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, requestFeed: vi.fn() };
});

const mockRequestFeed = vi.mocked(requestFeed);

const RANGE: FeedTimeRange = {
  from: "2026-07-26T11:45:00.000Z",
  to: "2026-07-26T12:00:00.000Z",
  label: "Last 15 min",
};

function ledger(id: string, overrides: Partial<FeedLedgerEntry> = {}): FeedLedgerEntry {
  return {
    kind: "ledger",
    id,
    createdAt: "2026-07-26T12:00:00.000Z",
    type: "purchase",
    direction: "debit",
    amountCents: 100,
    balanceAfterCents: 0,
    studentUid: "s1",
    studentNumber: "700001",
    studentName: "Stu Dent",
    actorUid: "a1",
    actorName: "Ada Actor",
    tags: [],
    ...overrides,
  };
}

function audit(id: string): FeedAuditEntry {
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
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("filters and pagination", () => {
  test("composes the active range with filters and older-page requests", async () => {
    mockRequestFeed
      .mockResolvedValueOnce({
        entries: [ledger("r1")],
        nextCursor: "r2",
        repeatBuyers: [],
        repeatBuyersTruncated: false,
      })
      .mockResolvedValueOnce({
        entries: [ledger("r2")],
        nextCursor: "r3",
        repeatBuyers: [],
        repeatBuyersTruncated: false,
      })
      .mockResolvedValueOnce({
        entries: [ledger("r3")],
        nextCursor: null,
        repeatBuyers: [],
        repeatBuyersTruncated: false,
      });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    act(() => {
      result.current.setRange(RANGE);
    });
    await flush();
    expect(mockRequestFeed).toHaveBeenLastCalledWith({ from: RANGE.from, to: RANGE.to });

    act(() => {
      result.current.setFilter({ kind: "type", type: "purchase" });
    });
    await flush();
    expect(mockRequestFeed).toHaveBeenLastCalledWith({
      type: "purchase",
      from: RANGE.from,
      to: RANGE.to,
    });

    act(() => {
      result.current.loadOlder();
    });
    await flush();
    expect(mockRequestFeed).toHaveBeenLastCalledWith({
      type: "purchase",
      from: RANGE.from,
      to: RANGE.to,
      cursor: "r3",
    });
  });

  test("changing the filter fetches with that filter and replaces the entries", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [ledger("t1")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    act(() => {
      result.current.setFilter({ kind: "type", type: "topup" });
    });
    await flush();

    expect(mockRequestFeed).toHaveBeenCalledWith({ type: "topup" });
    expect(result.current.filter).toEqual({ kind: "type", type: "topup" });
    expect(result.current.entries.map((e) => e.id)).toEqual(["t1"]);
    expect(result.current.loading).toBe(false);
  });

  test("re-selecting the active filter does not refetch", async () => {
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );
    act(() => {
      result.current.setFilter({ kind: "all" });
    });
    await flush();
    expect(mockRequestFeed).not.toHaveBeenCalled();
  });

  test("loadOlder appends the next page and advances the cursor", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [ledger("b")],
      nextCursor: "c2",
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: "c1" }),
    );

    act(() => {
      result.current.loadOlder();
    });
    await flush();

    expect(mockRequestFeed).toHaveBeenCalledWith({ cursor: "c1" });
    expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(result.current.cursor).toBe("c2");
  });

  test("a failed fetch surfaces an error message", async () => {
    mockRequestFeed.mockRejectedValue(new ApiError("RATE_LIMITED"));
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    act(() => {
      result.current.setFilter({ kind: "type", type: "refund" });
    });
    await flush();

    expect(result.current.error).toMatch(/too many/i);
    expect(result.current.loading).toBe(false);
  });

  test("manual refresh prepends only genuinely new entries", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [ledger("b"), ledger("a")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(result.current.entries.map((e) => e.id)).toEqual(["b", "a"]);
  });

  test("a refresh that still overlaps the loaded head keeps the pagination cursor", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [ledger("b"), ledger("a")],
      nextCursor: "head",
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a"), ledger("old")], initialCursor: "deep" }),
    );

    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(result.current.entries.map((e) => e.id)).toEqual(["b", "a", "old"]);
    expect(result.current.cursor).toBe("deep");
  });
});

describe("bursts larger than one page", () => {
  const HEAD_PAGE = 25;
  const burst = Array.from({ length: HEAD_PAGE }, (_, i) => ledger(`n${i + 1}`));

  function headOnlyResponse(): FeedDTO {
    return {
      entries: burst,
      nextCursor: "head",
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    };
  }

  test("a refresh whose head page no longer overlaps resets the list onto the head cursor", async () => {
    mockRequestFeed.mockResolvedValue(headOnlyResponse());
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a"), ledger("b")], initialCursor: "deep" }),
    );

    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(result.current.entries.map((e) => e.id)).toEqual(burst.map((e) => e.id));
    expect(result.current.cursor).toBe("head");
  });

  test("paging older after such a refresh reaches the entries the burst skipped", async () => {
    mockRequestFeed.mockResolvedValue(headOnlyResponse());
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a"), ledger("b")], initialCursor: "deep" }),
    );

    act(() => {
      result.current.refresh();
    });
    await flush();

    mockRequestFeed.mockResolvedValue({
      entries: [ledger("gap1"), ledger("gap2")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    act(() => {
      result.current.loadOlder();
    });
    await flush();

    expect(mockRequestFeed).toHaveBeenLastCalledWith({ cursor: "head" });
    expect(result.current.entries.map((e) => e.id)).toEqual([
      ...burst.map((e) => e.id),
      "gap1",
      "gap2",
    ]);
  });

  test("a refresh onto an empty feed adopts the cursor so older entries stay reachable", async () => {
    mockRequestFeed.mockResolvedValue(headOnlyResponse());
    const { result } = renderHook(() => useFeed({ initialEntries: [], initialCursor: null }));

    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(result.current.entries.map((e) => e.id)).toEqual(burst.map((e) => e.id));
    expect(result.current.cursor).toBe("head");
  });

  test("applying a poll's burst resets the list onto the head cursor", async () => {
    vi.useFakeTimers();
    try {
      mockRequestFeed.mockResolvedValue(headOnlyResponse());
      const { result } = renderHook(() =>
        useFeed({ initialEntries: [ledger("a"), ledger("b")], initialCursor: "deep" }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      });

      expect(result.current.pending).toHaveLength(HEAD_PAGE);
      expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);

      act(() => {
        result.current.applyPending();
      });

      expect(result.current.pending).toHaveLength(0);
      expect(result.current.entries.map((e) => e.id)).toEqual(burst.map((e) => e.id));
      expect(result.current.cursor).toBe("head");
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports a burst's pending count as a lower bound, since more may sit below the head page", async () => {
    vi.useFakeTimers();
    try {
      mockRequestFeed.mockResolvedValue(headOnlyResponse());
      const { result } = renderHook(() =>
        useFeed({ initialEntries: [ledger("a")], initialCursor: "deep" }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      });

      expect(result.current.pendingTruncated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("reports an overlapping poll's pending count as exact", async () => {
    vi.useFakeTimers();
    try {
      mockRequestFeed.mockResolvedValue({
        entries: [ledger("newer"), ledger("a")],
        nextCursor: "head",
        repeatBuyers: [],
        repeatBuyersTruncated: false,
      });
      const { result } = renderHook(() =>
        useFeed({ initialEntries: [ledger("a")], initialCursor: "deep" }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
      });

      expect(result.current.pending.map((e) => e.id)).toEqual(["newer"]);
      expect(result.current.pendingTruncated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ledger and audit rows sharing an id", () => {
  test("a refresh keeps both rows and does not treat one as already seen", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [audit("dup"), ledger("dup")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("dup")], initialCursor: null }),
    );

    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(result.current.entries.map((e) => `${e.kind}-${e.id}`)).toEqual([
      "audit-dup",
      "ledger-dup",
    ]);
  });
});

describe("interleaved requests", () => {
  function deferred(): { promise: Promise<FeedDTO>; resolve: (dto: FeedDTO) => void } {
    let resolve!: (dto: FeedDTO) => void;
    const promise = new Promise<FeedDTO>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  test("a refresh clicked during a filter load does not strand loading", async () => {
    const filterReq = deferred();
    const refreshReq = deferred();
    mockRequestFeed.mockReturnValueOnce(filterReq.promise).mockReturnValueOnce(refreshReq.promise);
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    act(() => {
      result.current.setFilter({ kind: "type", type: "topup" });
    });
    act(() => {
      result.current.refresh();
    });

    refreshReq.resolve({
      entries: [ledger("t2"), ledger("t1")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    await flush();
    expect(result.current.refreshing).toBe(false);

    filterReq.resolve({
      entries: [ledger("t1")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    await flush();

    expect(result.current.loading).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual(["t1"]);
  });

  test("a filter change during a refresh does not strand refreshing", async () => {
    const refreshReq = deferred();
    mockRequestFeed.mockReturnValueOnce(refreshReq.promise).mockResolvedValueOnce({
      entries: [ledger("t1")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    act(() => {
      result.current.refresh();
    });
    act(() => {
      result.current.setFilter({ kind: "type", type: "topup" });
    });
    await flush();
    expect(result.current.loading).toBe(false);

    refreshReq.resolve({
      entries: [ledger("stale")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    await flush();

    expect(result.current.refreshing).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual(["t1"]);
  });

  test("a filter change during loadOlder does not strand loadingOlder", async () => {
    const olderReq = deferred();
    mockRequestFeed.mockReturnValueOnce(olderReq.promise).mockResolvedValueOnce({
      entries: [ledger("t1")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: "c1" }),
    );

    act(() => {
      result.current.loadOlder();
    });
    act(() => {
      result.current.setFilter({ kind: "type", type: "topup" });
    });
    await flush();

    olderReq.resolve({
      entries: [ledger("old")],
      nextCursor: "c2",
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    await flush();

    expect(result.current.loadingOlder).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual(["t1"]);
    expect(result.current.cursor).toBe(null);
  });
});

describe("polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("surfaces new items as pending on the poll interval without disrupting the list", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [ledger("b"), ledger("a")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    expect(mockRequestFeed).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
    });

    expect(mockRequestFeed).toHaveBeenCalledTimes(1);
    expect(result.current.pending.map((e) => e.id)).toEqual(["b"]);
    expect(result.current.entries.map((e) => e.id)).toEqual(["a"]);

    act(() => {
      result.current.applyPending();
    });

    expect(result.current.pending).toHaveLength(0);
    expect(result.current.entries.map((e) => e.id)).toEqual(["b", "a"]);
  });

  test("a poll with nothing new leaves pending empty", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [ledger("a")],
      nextCursor: null,
      repeatBuyers: [],
      repeatBuyersTruncated: false,
    });
    const { result } = renderHook(() =>
      useFeed({ initialEntries: [ledger("a")], initialCursor: null }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FEED_POLL_MS);
    });

    expect(result.current.pending).toHaveLength(0);
  });
});
