import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { BuyerId } from "@/lib/ui/scanner";
import { LOOKUP_DEBOUNCE_MS, useSufficiency } from "./use-sufficiency";

const BUYER: BuyerId = { studentNumber: "123456" };

function okResponse(result: { name: string; sufficient: boolean }): Response {
  return { ok: true, json: async () => result } as Response;
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
  expect(result.current).toEqual({ status: "idle" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("debounces the lookup and resolves to a ready state", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(okResponse({ name: "Ada Lovelace", sufficient: true }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });

  expect(result.current).toEqual({ status: "checking", name: null });
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current).toEqual({ status: "ready", name: "Ada Lovelace", sufficient: true });
});

test("collapses rapid cart changes into a single request with the latest total", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ name: "Ada", sufficient: false }));
  vi.stubGlobal("fetch", fetchMock);

  const { rerender } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 50 },
  });

  rerender({ boothId: "b1", buyer: BUYER, cartTotalCents: 100 });
  rerender({ boothId: "b1", buyer: BUYER, cartTotalCents: 150 });
  rerender({ boothId: "b1", buyer: BUYER, cartTotalCents: 200 });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
  expect(body.cartTotalCents).toBe(200);
});

test("re-checks and flips sufficiency when the cart total crosses the balance", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(okResponse({ name: "Ada", sufficient: true }))
    .mockResolvedValueOnce(okResponse({ name: "Ada", sufficient: false }));
  vi.stubGlobal("fetch", fetchMock);

  const { result, rerender } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 1000 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current).toMatchObject({ status: "ready", sufficient: true });

  rerender({ boothId: "b1", buyer: BUYER, cartTotalCents: 1050 });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current).toMatchObject({ status: "ready", sufficient: false });
});

test("surfaces the server error code", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("SUSPENDED"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook((props) => useSufficiency(props), {
    initialProps: { boothId: "b1", buyer: BUYER, cartTotalCents: 500 },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LOOKUP_DEBOUNCE_MS);
  });
  expect(result.current).toEqual({ status: "error", code: "SUSPENDED" });
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
  expect(result.current).toEqual({ status: "idle" });

  await act(async () => {
    resolveFirst(okResponse({ name: "Ada", sufficient: true }));
    await Promise.resolve();
  });
  expect(result.current).toEqual({ status: "idle" });
});
