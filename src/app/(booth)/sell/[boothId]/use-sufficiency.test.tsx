import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RecentPurchase } from "@/lib/shared/types";
import type { BuyerId } from "@/lib/ui/scanner";
import { LOOKUP_DEBOUNCE_MS, LOOKUP_RETRY_DELAYS_MS, useSufficiency } from "./use-sufficiency";

const BUYER: BuyerId = { studentNumber: "123456" };

const RETRY_WINDOW_MS =
  LOOKUP_DEBOUNCE_MS + LOOKUP_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) + 100;

function okResponse(result: {
  name: string;
  balanceCents: number;
  lastPurchase?: RecentPurchase;
}): Response {
  return { ok: true, json: async () => ({ lastPurchase: null, ...result }) } as Response;
}

function errorResponse(code: string): Response {
  return { ok: false, json: async () => ({ error: { code } }) } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("stays idle while no buyer is identified", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: null as BuyerId | null, cartTotalCents: 0 },
  });
  expect(result.current.state).toEqual({ status: "idle" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("debounces the lookup and resolves to a ready state", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(okResponse({ name: "Ada Lovelace", balanceCents: 800 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });

  expect(result.current.state).toEqual({ status: "checking", name: null });
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current.state).toEqual({
    status: "ready",
    name: "Ada Lovelace",
    balanceCents: 800,
    sufficient: true,
    lastPurchase: null,
  });
});

test("never sends the cart total to the server", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ name: "Ada", balanceCents: 800 }));
  vi.stubGlobal("fetch", fetchMock);

  renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });

  const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(body).toEqual({ boothId: "b1", buyer: BUYER });
});

test("stamps when the sale's age was observed, so no server clock reaches the render", async () => {
  vi.setSystemTime(new Date("2031-04-01T00:00:00Z"));
  const fetchMock = vi.fn().mockResolvedValue(
    okResponse({
      name: "Ada",
      balanceCents: 800,
      lastPurchase: { amountCents: 450, ageMs: 8_000 },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });

  expect(result.current.state).toEqual({
    status: "ready",
    name: "Ada",
    balanceCents: 800,
    sufficient: true,
    lastPurchase: { amountCents: 450, ageMs: 8_000, observedAt: Date.now() },
  });
});

test("re-prices the cart against the cached balance without a second lookup", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ name: "Ada", balanceCents: 1000 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 1000 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current.state).toMatchObject({ status: "ready", sufficient: true });

  rerender({ boothId: "b1", buyer: BUYER, cartTotalCents: 1050 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current.state).toMatchObject({ status: "ready", sufficient: false });

  rerender({ boothId: "b1", buyer: BUYER, cartTotalCents: 250 });
  expect(result.current.state).toMatchObject({ status: "ready", sufficient: true });

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("does not re-fire as the cart is built up", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ name: "Ada", balanceCents: 5000 }));
  vi.stubGlobal("fetch", fetchMock);

  const { rerender } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 50 },
  });

  for (const cartTotalCents of [100, 150, 200, 250, 300]) {
    rerender({ boothId: "b1", buyer: BUYER, cartTotalCents });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
    });
  }

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("surfaces a settled server error without retrying", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("SUSPENDED"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
  });
  expect(result.current.state).toEqual({
    status: "error",
    code: "SUSPENDED",
    retryable: false,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("recovers from a transient lookup failure without operator action", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(errorResponse("RATE_LIMITED"))
    .mockResolvedValueOnce(okResponse({ name: "Ada Lovelace", balanceCents: 800 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.state).toMatchObject({
    status: "ready",
    name: "Ada Lovelace",
    balanceCents: 800,
  });
});

test("stays in checking while transient retries are still pending", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("INTERNAL"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current.state).toEqual({ status: "checking", name: null });
});

test("gives up as retryable after the backoff schedule is exhausted", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("RATE_LIMITED"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
  });

  expect(fetchMock).toHaveBeenCalledTimes(LOOKUP_RETRY_DELAYS_MS.length + 1);
  expect(result.current.state).toEqual({
    status: "error",
    code: "RATE_LIMITED",
    retryable: true,
  });
});

test("a manual retry re-checks the same buyer", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("RATE_LIMITED"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
  });
  expect(result.current.state).toMatchObject({ status: "error", retryable: true });

  fetchMock.mockResolvedValue(okResponse({ name: "Ada", balanceCents: 800 }));
  act(() => result.current.refresh());
  expect(result.current.state).toEqual({ status: "checking", name: null });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current.state).toMatchObject({ status: "ready", name: "Ada" });
});

test("a refresh re-reads the balance and keeps the name on screen while it does", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okResponse({ name: "Ada", balanceCents: 200 }))
    .mockResolvedValueOnce(okResponse({ name: "Ada", balanceCents: 2000 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current.state).toMatchObject({ balanceCents: 200, sufficient: false });

  act(() => result.current.refresh());
  expect(result.current.state).toEqual({ status: "checking", name: "Ada" });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.state).toMatchObject({ balanceCents: 2000, sufficient: true });
});

test("treats a network failure as retryable", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(okResponse({ name: "Ada", balanceCents: 800 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
  });

  expect(result.current.state).toMatchObject({ status: "ready", name: "Ada" });
});

test("a fresh scan of the same buyer re-checks instead of serving the cached lookup", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okResponse({ name: "Ada", balanceCents: 800 }))
    .mockResolvedValueOnce(
      okResponse({
        name: "Ada",
        balanceCents: 800,
        lastPurchase: { amountCents: 500, ageMs: 3_000 },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current.state).toMatchObject({ status: "ready", lastPurchase: null });

  rerender({ boothId: "b1", buyer: { studentNumber: "123456" }, cartTotalCents: 500 });
  expect(result.current.state.status).toBe("checking");

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current.state).toMatchObject({
    status: "ready",
    lastPurchase: { amountCents: 500, ageMs: 3_000 },
  });
});

test("ignores a late response after the buyer is cleared", async () => {
  let resolveFirst: (r: Response) => void = () => {};
  const fetchMock = vi.fn().mockReturnValueOnce(
    new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER as BuyerId | null, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  rerender({ boothId: "b1", buyer: null, cartTotalCents: 500 });
  expect(result.current.state).toEqual({ status: "idle" });

  await act(async () => {
    resolveFirst(okResponse({ name: "Ada", balanceCents: 800 }));
    await Promise.resolve();
  });
  expect(result.current.state).toEqual({ status: "idle" });
});
