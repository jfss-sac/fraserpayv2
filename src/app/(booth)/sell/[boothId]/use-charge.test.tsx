import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { BuyerId } from "@/lib/ui/scanner";
import { cartToItems, chargeErrorMessage, useCharge } from "./use-charge";

const BUYER: BuyerId = { studentNumber: "123456" };
const ITEMS = [{ itemId: "taco", qty: 2 }];

function okResponse(result: { entryId: string; amountCents: number }): Response {
  return { ok: true, json: async () => result } as Response;
}

function errorResponse(code: string): Response {
  return { ok: false, json: async () => ({ error: { code } }) } as Response;
}

function keyOf(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get("idempotency-key");
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("cartToItems drops zero quantities and maps the rest", () => {
  expect(cartToItems({ taco: 2, water: 0, custom: 3 })).toEqual([
    { itemId: "taco", qty: 2 },
    { itemId: "custom", qty: 3 },
  ]);
});

test("chargeErrorMessage maps known codes and falls back", () => {
  expect(chargeErrorMessage("INSUFFICIENT_FUNDS")).toBe("Balance can't cover this cart.");
  expect(chargeErrorMessage("NETWORK")).toContain("connection");
  expect(chargeErrorMessage("WHATEVER")).toBe("Charge failed. Try again.");
});

test("sends a valid UUID v4 idempotency key and reports success", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }));
  vi.stubGlobal("fetch", fetchMock);

  const onSuccess = vi.fn();
  const { result } = renderHook(() => useCharge({ boothId: "b1", onSuccess }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
  });

  expect(keyOf(fetchMock.mock.calls[0]!)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(result.current.state).toEqual({ status: "success", amountCents: 500, buyerName: "Ada" });
  expect(onSuccess).toHaveBeenCalledWith({ entryId: "e1", amountCents: 500, buyerName: "Ada" });
});

test("reuses the same idempotency key across an automatic retry", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce(okResponse({ entryId: "e1", amountCents: 500 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1" }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).toBe(keyOf(fetchMock.mock.calls[1]!));
  expect(result.current.state).toMatchObject({ status: "success", amountCents: 500 });
});

test("generates a fresh idempotency key for each charge gesture", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e", amountCents: 250 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1" }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
  });
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[1]!));
});

test("surfaces a business error without retrying", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("INSUFFICIENT_FUNDS"));
  vi.stubGlobal("fetch", fetchMock);

  const onError = vi.fn();
  const { result } = renderHook(() => useCharge({ boothId: "b1", onError }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current.state).toEqual({ status: "error", code: "INSUFFICIENT_FUNDS" });
  expect(onError).toHaveBeenCalledWith("INSUFFICIENT_FUNDS");
});

test("gives up with a NETWORK error after exhausting retries", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1" }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
  });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.current.state).toEqual({ status: "error", code: "NETWORK" });
});

test("ignores a second gesture while a charge is in flight", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e", amountCents: 250 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1" }));
  await act(async () => {
    const first = result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
    const second = result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS });
    await Promise.all([first, second]);
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("does nothing when the cart is empty", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1" }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: [] });
  });

  expect(fetchMock).not.toHaveBeenCalled();
  expect(result.current.state).toEqual({ status: "idle" });
});
