import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FeedDTO, FeedLedgerEntry } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { requestFeed } from "./api";
import { FEED_POLL_MS, useFeed } from "./use-feed";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, requestFeed: vi.fn() };
});

const mockRequestFeed = vi.mocked(requestFeed);

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
  test("changing the filter fetches with that filter and replaces the entries", async () => {
    mockRequestFeed.mockResolvedValue({
      entries: [ledger("t1")],
      nextCursor: null,
      repeatBuyers: [],
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
    });
    await flush();
    expect(result.current.refreshing).toBe(false);

    filterReq.resolve({ entries: [ledger("t1")], nextCursor: null, repeatBuyers: [] });
    await flush();

    expect(result.current.loading).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual(["t1"]);
  });

  test("a filter change during a refresh does not strand refreshing", async () => {
    const refreshReq = deferred();
    mockRequestFeed
      .mockReturnValueOnce(refreshReq.promise)
      .mockResolvedValueOnce({ entries: [ledger("t1")], nextCursor: null, repeatBuyers: [] });
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

    refreshReq.resolve({ entries: [ledger("stale")], nextCursor: null, repeatBuyers: [] });
    await flush();

    expect(result.current.refreshing).toBe(false);
    expect(result.current.entries.map((e) => e.id)).toEqual(["t1"]);
  });

  test("a filter change during loadOlder does not strand loadingOlder", async () => {
    const olderReq = deferred();
    mockRequestFeed
      .mockReturnValueOnce(olderReq.promise)
      .mockResolvedValueOnce({ entries: [ledger("t1")], nextCursor: null, repeatBuyers: [] });
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

    olderReq.resolve({ entries: [ledger("old")], nextCursor: "c2", repeatBuyers: [] });
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
