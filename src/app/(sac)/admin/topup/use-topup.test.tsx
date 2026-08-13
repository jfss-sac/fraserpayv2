import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { parsePendingTopUps, readPendingTopUpsRaw } from "@/lib/ui/pending-topup";
import type { BuyerId } from "@/lib/ui/scanner";
import { type TopUpSubmission, useTopUp } from "./use-topup";

const BUYER: BuyerId = { studentNumber: "123456" };
const ACTOR = "sac-1";
const SUBMISSION: TopUpSubmission = {
  buyer: BUYER,
  studentName: "Ada",
  amountCents: 1000,
  method: "cash",
};

function okResponse(result: unknown, opts: { replayed?: boolean } = {}): Response {
  const headers = new Headers(opts.replayed ? { "idempotent-replay": "true" } : {});
  return { ok: true, headers, json: async () => result } as Response;
}

function errorResponse(code: string): Response {
  return { ok: false, headers: new Headers(), json: async () => ({ error: { code } }) } as Response;
}

function keyOf(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get("idempotency-key");
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function persisted() {
  return parsePendingTopUps(readPendingTopUpsRaw(ACTOR));
}

test("reuses the idempotency key when the same top-up is retried after a network failure", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  expect(result.current.state).toEqual({ status: "error", code: "NETWORK" });
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(new Set(fetchMock.mock.calls.map(keyOf)).size).toBe(1);
});

test("keeps the idempotency key when the same top-up is repeated after Start over", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  act(() => {
    result.current.reset();
  });
  expect(result.current.state).toEqual({ status: "idle" });
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(new Set(fetchMock.mock.calls.map(keyOf)).size).toBe(1);
});

test("reports a replay when a repeat after Start over is absorbed by the server", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockRejectedValueOnce(new TypeError("network"))
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValue(okResponse({ entryId: "e1" }, { replayed: true }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  act(() => {
    result.current.reset();
  });
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(result.current.state).toEqual({
    status: "success",
    result: { entryId: "e1" },
    studentName: "Ada",
    replayed: true,
    recovered: false,
  });
});

test("does not report a replay when the key was freshly minted", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValue(okResponse({ entryId: "e1" }, { replayed: true }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(result.current.state).toEqual({
    status: "success",
    result: { entryId: "e1" },
    studentName: "Ada",
    replayed: false,
    recovered: false,
  });
});

test("mints a fresh idempotency key for an identical top-up after success", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e1" }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[1]!));
});

test("persists the key, buyer and amount before the request goes out", async () => {
  const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    void result.current.submit(SUBMISSION);
  });

  expect(persisted()).toEqual([
    expect.objectContaining({
      key: keyOf(fetchMock.mock.calls[0]!),
      studentName: "Ada",
      amountCents: 1000,
      method: "cash",
      buyer: BUYER,
    }),
  ]);
});

test("clears the persisted record once the top-up settles", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e1" }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });

  expect(persisted()).toEqual([]);
});

test("keeps the record when the outcome is unknown and drops it only on a cap rejection", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  expect(persisted()).toHaveLength(1);

  fetchMock.mockResolvedValue(errorResponse("CAP_EXCEEDED"));
  await act(async () => {
    await result.current.submit({ ...SUBMISSION, amountCents: 20_000 });
  });
  expect(persisted()).toHaveLength(1);
  expect(persisted()[0]?.amountCents).toBe(1000);
});

test("a reload surfaces the stranded top-up, and Retry replays its original key", async () => {
  const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit(SUBMISSION);
  });
  const strandedKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1" }, { replayed: true }));
  const reopened = renderHook(() => useTopUp({ actorUid: ACTOR }));
  expect(reopened.result.current.recovered).toMatchObject({ key: strandedKey });

  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });

  expect(keyOf(fetchMock.mock.calls.at(-1)!)).toBe(strandedKey);
  expect(reopened.result.current.state).toMatchObject({
    status: "success",
    studentName: "Ada",
    replayed: true,
    recovered: true,
  });
  expect(persisted()).toEqual([]);
  expect(reopened.result.current.recovered).toBeNull();
});

test("dismissing a stranded top-up keeps its key, so a re-rung identical top-up replays", async () => {
  const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit(SUBMISSION);
  });
  const strandedKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockRejectedValue(new TypeError("network"));
  const reopened = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });
  act(() => {
    reopened.result.current.dismissRecovered();
  });
  expect(reopened.result.current.recovered).toBeNull();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1" }, { replayed: true }));
  await act(async () => {
    await reopened.result.current.submit(SUBMISSION);
  });

  expect(keyOf(fetchMock.mock.calls.at(-1)!)).toBe(strandedKey);
  expect(reopened.result.current.state).toMatchObject({ replayed: true });
});

test("does not surface this session's own in-flight top-up as a recovery", async () => {
  const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    void result.current.submit(SUBMISSION);
  });

  expect(persisted()).toHaveLength(1);
  expect(result.current.recovered).toBeNull();
});

test("scopes stranded top-ups to the member who rang them", async () => {
  const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit(SUBMISSION);
  });
  crashed.unmount();

  const other = renderHook(() => useTopUp({ actorUid: "sac-2" }));
  expect(other.result.current.recovered).toBeNull();
});

test("mints a fresh idempotency key when an override reason is added after a cap rejection", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(errorResponse("CAP_EXCEEDED"))
    .mockResolvedValue(okResponse({ entryId: "e1" }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useTopUp({ actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit(SUBMISSION);
  });
  await act(async () => {
    await result.current.submit({ ...SUBMISSION, overrideReason: "principal approved" });
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[1]!));
});
