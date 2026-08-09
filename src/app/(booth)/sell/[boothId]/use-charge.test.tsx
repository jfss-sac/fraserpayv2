import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { parsePendingCharges, readPendingChargesRaw } from "@/lib/ui/pending-charge";
import type { BuyerId } from "@/lib/ui/scanner";
import { cartToItems, chargeErrorMessage, useCharge } from "./use-charge";

const BUYER: BuyerId = { studentNumber: "123456" };
const OTHER_BUYER: BuyerId = { studentNumber: "654321" };
const ITEMS = [{ itemId: "taco", qty: 2 }];
const OTHER_ITEMS = [{ itemId: "water", qty: 1 }];
const ACTOR = "operator-1";
const SCOPE = { actorUid: ACTOR, boothId: "b1" };

function allPersisted() {
  return parsePendingCharges(readPendingChargesRaw(SCOPE));
}

function persisted() {
  return allPersisted()[0] ?? null;
}

function neverResolves(): Promise<Response> {
  return new Promise<Response>(() => {});
}

function okResponse(
  result: { entryId: string; amountCents: number },
  opts: { replayed?: boolean } = {},
): Response {
  const headers = new Headers(opts.replayed ? { "idempotent-replay": "true" } : {});
  return { ok: true, headers, json: async () => result } as Response;
}

function errorResponse(code: string): Response {
  return {
    ok: false,
    headers: new Headers(),
    json: async () => ({ error: { code } }),
  } as Response;
}

function keyOf(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get("idempotency-key");
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
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
  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onSuccess }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(keyOf(fetchMock.mock.calls[0]!)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(result.current.state).toEqual({ status: "success", amountCents: 500, buyerName: "Ada" });
  expect(onSuccess).toHaveBeenCalledWith({
    entryId: "e1",
    amountCents: 500,
    buyerName: "Ada",
    recovered: false,
    replayed: false,
  });
});

test("reuses the same idempotency key across an automatic retry", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce(okResponse({ entryId: "e1", amountCents: 500 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).toBe(keyOf(fetchMock.mock.calls[1]!));
  expect(result.current.state).toMatchObject({ status: "success", amountCents: 500 });
});

test("generates a fresh idempotency key for each charge gesture", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e", amountCents: 250 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[1]!));
});

test("reuses the idempotency key when the same charge is retried after a network failure", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });
  expect(result.current.state).toEqual({ status: "error", code: "NETWORK" });
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect(new Set(fetchMock.mock.calls.map(keyOf)).size).toBe(1);
});

test("mints a fresh idempotency key when the cart changes after a failure", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });
  await act(async () => {
    await result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: [{ itemId: "taco", qty: 3 }],
      amountCents: 750,
    });
  });

  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[3]!));
});

test("surfaces a business error without retrying", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("INSUFFICIENT_FUNDS"));
  vi.stubGlobal("fetch", fetchMock);

  const onError = vi.fn();
  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onError }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result.current.state).toEqual({ status: "error", code: "INSUFFICIENT_FUNDS" });
  expect(onError).toHaveBeenCalledWith("INSUFFICIENT_FUNDS");
});

test("gives up with a NETWORK error after exhausting retries", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.current.state).toEqual({ status: "error", code: "NETWORK" });
});

test("ignores a second gesture while a charge is in flight", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e", amountCents: 250 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    const first = result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
    const second = result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
    await Promise.all([first, second]);
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("does nothing when the cart is empty", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: [], amountCents: 0 });
  });

  expect(fetchMock).not.toHaveBeenCalled();
  expect(result.current.state).toEqual({ status: "idle" });
});

test("persists the charge before the request goes out and clears it on success", async () => {
  const fetchMock = vi.fn().mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(persisted()).toBeNull();
});

test("does not offer its own in-flight charge as a recovery", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(persisted()).toMatchObject({
    key: keyOf(fetchMock.mock.calls[0]!),
    amountCents: 500,
    buyerName: "Ada",
  });
  expect(result.current.recovered).toBeNull();
});

test("recovers an interrupted charge after a crash and replays it with the same key", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const sentKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  const recovered = reopened.result.current.recovered;
  expect(recovered).toMatchObject({ key: sentKey, amountCents: 500, buyerName: "Ada" });

  await act(async () => {
    await reopened.result.current.retryRecovered(recovered!);
  });

  expect(keyOf(fetchMock.mock.calls[1]!)).toBe(sentKey);
  expect(reopened.result.current.state).toMatchObject({ status: "success", amountCents: 500 });
  expect(persisted()).toBeNull();
});

test("a genuinely re-rung identical cart after a crash still mints a fresh key", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const sentKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e2", amountCents: 500 }));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await reopened.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });

  expect(keyOf(fetchMock.mock.calls[1]!)).not.toBe(sentKey);
});

test("keeps the persisted charge when the network never answers", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(result.current.state).toEqual({ status: "error", code: "NETWORK" });
  expect(persisted()).toMatchObject({ key: keyOf(fetchMock.mock.calls[0]!) });
});

test("clears the persisted charge when the server definitively rejects it", async () => {
  const fetchMock = vi.fn().mockResolvedValue(errorResponse("INSUFFICIENT_FUNDS"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(persisted()).toBeNull();
});

test("dismissing a recovered charge drops it", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  crashed.unmount();

  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  expect(reopened.result.current.recovered).not.toBeNull();
  act(() => {
    reopened.result.current.dismissRecovered();
  });

  expect(reopened.result.current.recovered).toBeNull();
  expect(persisted()).toBeNull();
});

test("scopes the recovered charge to the operator who rang it", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  crashed.unmount();

  const other = renderHook(() => useCharge({ boothId: "b1", actorUid: "operator-2" }));
  expect(other.result.current.recovered).toBeNull();
});

test("reset forgets the gesture entirely — held key and persisted charge alike", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });
  expect(persisted()).not.toBeNull();

  act(() => {
    result.current.reset();
  });
  expect(persisted()).toBeNull();

  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[3]!));
});

test("a recovered charge that fails again stays recoverable and holds its key", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const sentKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockRejectedValue(new TypeError("network"));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });

  expect(reopened.result.current.state).toEqual({ status: "error", code: "NETWORK" });
  expect(reopened.result.current.recovered).toMatchObject({ key: sentKey });

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }));
  await act(async () => {
    await reopened.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  expect(keyOf(fetchMock.mock.calls.at(-1)!)).toBe(sentKey);
});

test("keeps the record when a retry is rate-limited — that says nothing about the original", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const sentKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockResolvedValue(errorResponse("RATE_LIMITED"));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });

  expect(reopened.result.current.state).toEqual({ status: "error", code: "RATE_LIMITED" });
  expect(persisted()).toMatchObject({ key: sentKey });
  expect(reopened.result.current.recovered).toMatchObject({ key: sentKey });
});

test("keeps the record for every code that cannot prove the original never landed", async () => {
  for (const code of ["RATE_LIMITED", "VALIDATION", "NOT_FOUND", "FORBIDDEN", "SUSPENDED"]) {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(code));
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
    await act(async () => {
      await result.current.submit({
        buyer: BUYER,
        buyerName: "Ada",
        items: ITEMS,
        amountCents: 500,
      });
    });
    expect(persisted(), `${code} must not discard the recovery record`).not.toBeNull();

    unmount();
    localStorage.clear();
  }
});

test("clears the record only for codes raised inside the transaction", async () => {
  for (const code of ["INSUFFICIENT_FUNDS", "BOOTH_NOT_SELLABLE"]) {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(code));
    vi.stubGlobal("fetch", fetchMock);

    const { result, unmount } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
    await act(async () => {
      await result.current.submit({
        buyer: BUYER,
        buyerName: "Ada",
        items: ITEMS,
        amountCents: 500,
      });
    });
    expect(persisted(), `${code} proves the charge never committed`).toBeNull();

    unmount();
    localStorage.clear();
  }
});

test("reports whether a success came from the recovery card", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);
  const onSuccess = vi.fn();

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onSuccess }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  crashed.unmount();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onSuccess }));
  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });
  expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ recovered: true }));

  onSuccess.mockClear();
  await act(async () => {
    await reopened.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ recovered: false }));
});

test("reports a replay when a re-rung identical cart reuses the key held by a failure", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);
  const onSuccess = vi.fn();

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onSuccess }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });
  expect(result.current.state).toEqual({ status: "error", code: "NETWORK" });

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }, { replayed: true }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(keyOf(fetchMock.mock.calls[0]!)).toBe(keyOf(fetchMock.mock.calls.at(-1)!));
  expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ replayed: true }));
});

test("never claims a replay when its own internal retry replays a freshly minted key", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValueOnce(okResponse({ entryId: "e1", amountCents: 500 }, { replayed: true }));
  vi.stubGlobal("fetch", fetchMock);
  const onSuccess = vi.fn();

  const { result } = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onSuccess }));
  await act(async () => {
    await result.current.submit({ buyer: BUYER, buyerName: "Ada", items: ITEMS, amountCents: 500 });
  });

  expect(keyOf(fetchMock.mock.calls[0]!)).toBe(keyOf(fetchMock.mock.calls[1]!));
  expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ replayed: false }));
});

test("dismissing a recovered charge releases its held key so the next identical sale charges fresh", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const sentKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockRejectedValue(new TypeError("network"));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });
  expect(reopened.result.current.recovered).not.toBeNull();

  act(() => {
    reopened.result.current.dismissRecovered();
  });
  expect(reopened.result.current.recovered).toBeNull();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e2", amountCents: 500 }));
  await act(async () => {
    await reopened.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  expect(keyOf(fetchMock.mock.calls.at(-1)!)).not.toBe(sentKey);
});

test("ringing the next customer leaves an earlier stranded charge recoverable", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const strandedKey = keyOf(fetchMock.mock.calls[0]!);
  crashed.unmount();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e2", amountCents: 250 }));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  expect(reopened.result.current.recovered).toMatchObject({ key: strandedKey });

  await act(async () => {
    await reopened.result.current.submit({
      buyer: OTHER_BUYER,
      buyerName: "Grace",
      items: OTHER_ITEMS,
      amountCents: 250,
    });
  });

  expect(reopened.result.current.recovered).toMatchObject({ key: strandedKey });
  expect(allPersisted().map((record) => record.key)).toEqual([strandedKey]);

  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });
  expect(keyOf(fetchMock.mock.calls.at(-1)!)).toBe(strandedKey);
  expect(allPersisted()).toEqual([]);
});

test("surfaces stranded charges oldest first, resolving them one at a time", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);
  const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

  const first = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void first.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const firstKey = keyOf(fetchMock.mock.calls[0]!);
  first.unmount();

  nowSpy.mockReturnValue(1_060_000);
  const second = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void second.result.current.submit({
      buyer: OTHER_BUYER,
      buyerName: "Grace",
      items: OTHER_ITEMS,
      amountCents: 250,
    });
  });
  const secondKey = keyOf(fetchMock.mock.calls[1]!);
  second.unmount();

  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  expect(reopened.result.current.recovered).toMatchObject({ key: firstKey, buyerName: "Ada" });

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }));
  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });
  expect(reopened.result.current.recovered).toMatchObject({ key: secondKey, buyerName: "Grace" });

  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });
  expect(reopened.result.current.recovered).toBeNull();
});

test("dismissing one stranded charge surfaces the next instead of dropping it", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);
  const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

  const first = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void first.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  const firstKey = keyOf(fetchMock.mock.calls[0]!);
  first.unmount();

  nowSpy.mockReturnValue(1_060_000);
  const second = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  await act(async () => {
    void second.result.current.submit({
      buyer: OTHER_BUYER,
      buyerName: "Grace",
      items: OTHER_ITEMS,
      amountCents: 250,
    });
  });
  const secondKey = keyOf(fetchMock.mock.calls[1]!);
  second.unmount();

  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR }));
  expect(reopened.result.current.recovered).toMatchObject({ key: firstKey });

  act(() => {
    reopened.result.current.dismissRecovered();
  });

  expect(reopened.result.current.recovered).toMatchObject({ key: secondKey });
  expect(allPersisted().map((record) => record.key)).toEqual([secondKey]);
});

test("reports a replay when the recovery card's retry finds the original already committed", async () => {
  const fetchMock = vi.fn().mockImplementation(neverResolves);
  vi.stubGlobal("fetch", fetchMock);
  const onSuccess = vi.fn();

  const crashed = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onSuccess }));
  await act(async () => {
    void crashed.result.current.submit({
      buyer: BUYER,
      buyerName: "Ada",
      items: ITEMS,
      amountCents: 500,
    });
  });
  crashed.unmount();

  fetchMock.mockResolvedValue(okResponse({ entryId: "e1", amountCents: 500 }, { replayed: true }));
  const reopened = renderHook(() => useCharge({ boothId: "b1", actorUid: ACTOR, onSuccess }));
  await act(async () => {
    await reopened.result.current.retryRecovered(reopened.result.current.recovered!);
  });

  expect(onSuccess).toHaveBeenCalledWith(
    expect.objectContaining({ recovered: true, replayed: true }),
  );
});
