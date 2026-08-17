import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { BoothHistoryDTO, BoothHistoryEntry } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { requestBoothHistory } from "@/lib/ui/booth-history-api";
import { useBoothHistory } from "@/lib/ui/use-booth-history";

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
    amountCents: 300,
    direction: "debit",
    buyerName: "Stu Dent",
    lineItems: [{ itemId: "slice", name: "Slice", qty: 1, unitPriceCents: 300 }],
    actorName: "Ada Actor",
    ...overrides,
  };
}

function pageOf(ids: string[], nextCursor: string | null = null): BoothHistoryDTO {
  return { entries: ids.map((id) => entry(id)), nextCursor };
}

function deferred(): {
  promise: Promise<BoothHistoryDTO>;
  resolve: (dto: BoothHistoryDTO) => void;
} {
  let resolve!: (dto: BoothHistoryDTO) => void;
  const promise = new Promise<BoothHistoryDTO>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount(onError?: (message: string) => void) {
  return renderHook(() => useBoothHistory({ boothId: "booth-1", onError }));
}

afterEach(() => {
  vi.clearAllMocks();
});

test("loads the head page on mount and leaves the skeleton behind", async () => {
  mockRequest.mockResolvedValue(pageOf(["e1", "e2"], "e2"));

  const { result } = mount();
  expect(result.current.loading).toBe(true);
  await flush();

  expect(mockRequest).toHaveBeenCalledWith("booth-1", { mine: false });
  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e1", "e2"]);
  expect(result.current.cursor).toBe("e2");
  expect(result.current.loading).toBe(false);
});

test("reports a failed first load and retries it on demand", async () => {
  const onError = vi.fn();
  mockRequest.mockRejectedValueOnce(new ApiError("RATE_LIMITED"));

  const { result } = mount(onError);
  await flush();

  expect(result.current.loading).toBe(false);
  expect(result.current.error).toMatch(/too many refreshes/i);
  expect(onError).toHaveBeenCalledWith(result.current.error);

  mockRequest.mockResolvedValueOnce(pageOf(["e1"]));
  act(() => {
    result.current.retry();
  });
  expect(result.current.loading).toBe(true);
  await flush();

  expect(result.current.error).toBeNull();
  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e1"]);
});

test("re-fetches from the head when the scope toggles", async () => {
  mockRequest.mockResolvedValueOnce(pageOf(["e1", "e2"], "e2"));
  const { result } = mount();
  await flush();

  mockRequest.mockResolvedValueOnce(pageOf(["e2"]));
  act(() => {
    result.current.setScope("mine");
  });
  expect(result.current.loading).toBe(true);
  expect(result.current.entries).toEqual([]);
  await flush();

  expect(mockRequest).toHaveBeenLastCalledWith("booth-1", { mine: true });
  expect(result.current.scope).toBe("mine");
  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e2"]);
  expect(result.current.cursor).toBeNull();
});

test("a refresh replaces the list instead of prepending to it", async () => {
  mockRequest.mockResolvedValueOnce(pageOf(["e3", "e2", "e1"], "e1"));
  const { result } = mount();
  await flush();

  mockRequest.mockResolvedValueOnce(pageOf(["e9", "e8"], "e8"));
  act(() => {
    result.current.refresh();
  });
  expect(result.current.refreshing).toBe(true);
  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e3", "e2", "e1"]);
  await flush();

  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e9", "e8"]);
  expect(result.current.cursor).toBe("e8");
  expect(result.current.refreshing).toBe(false);
});

test("keeps the loaded rows when a refresh fails", async () => {
  const onError = vi.fn();
  mockRequest.mockResolvedValueOnce(pageOf(["e1"]));
  const { result } = mount(onError);
  await flush();

  mockRequest.mockRejectedValueOnce(new Error("offline"));
  act(() => {
    result.current.refresh();
  });
  await flush();

  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e1"]);
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toMatch(/couldn't reach the server/i);
  expect(onError).toHaveBeenCalledTimes(1);
});

test("pages older rows onto the end, ignoring any that are already shown", async () => {
  mockRequest.mockResolvedValueOnce(pageOf(["e3", "e2"], "e2"));
  const { result } = mount();
  await flush();

  mockRequest.mockResolvedValueOnce(pageOf(["e2", "e1"], "e1"));
  act(() => {
    result.current.loadOlder();
  });
  await flush();

  expect(mockRequest).toHaveBeenLastCalledWith("booth-1", { mine: false, cursor: "e2" });
  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e3", "e2", "e1"]);
  expect(result.current.cursor).toBe("e1");
});

test("drops an older page that lands after the list was replaced", async () => {
  mockRequest.mockResolvedValueOnce(pageOf(["e3", "e2"], "e2"));
  const { result } = mount();
  await flush();

  const older = deferred();
  mockRequest.mockReturnValueOnce(older.promise);
  act(() => {
    result.current.loadOlder();
  });

  mockRequest.mockResolvedValueOnce(pageOf(["e9"], null));
  act(() => {
    result.current.refresh();
  });
  await flush();

  await act(async () => {
    older.resolve(pageOf(["e1"], "e1"));
    await older.promise;
  });

  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e9"]);
  expect(result.current.cursor).toBeNull();
});

test("retries the same cursor after a failed older page", async () => {
  mockRequest.mockResolvedValueOnce(pageOf(["e3", "e2"], "e2"));
  const { result } = mount();
  await flush();

  mockRequest.mockRejectedValueOnce(new Error("offline"));
  act(() => {
    result.current.loadOlder();
  });
  await flush();

  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e3", "e2"]);
  expect(result.current.error).not.toBeNull();

  mockRequest.mockResolvedValueOnce(pageOf(["e1"], null));
  act(() => {
    result.current.retry();
  });
  await flush();

  expect(mockRequest).toHaveBeenLastCalledWith("booth-1", { mine: false, cursor: "e2" });
  expect(result.current.entries.map((e) => e.entryId)).toEqual(["e3", "e2", "e1"]);
  expect(result.current.error).toBeNull();
});
