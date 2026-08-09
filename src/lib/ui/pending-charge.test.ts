import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  type PendingCharge,
  PENDING_CHARGE_SHOW_WINDOW_MS,
  clearPendingCharge,
  parsePendingCharge,
  readPendingChargeRaw,
  subscribePendingCharge,
  usePendingCharge,
  writePendingCharge,
} from "./pending-charge";

const SCOPE = { actorUid: "operator-1", boothId: "booth-1" };

function pendingCharge(overrides: Partial<PendingCharge> = {}): PendingCharge {
  return {
    key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
    sessionId: "session-1",
    buyer: { studentNumber: "123456" },
    buyerName: "Ada Lovelace",
    items: [{ itemId: "taco", qty: 2 }],
    amountCents: 450,
    startedAt: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
});

test("round-trips a pending charge through storage", () => {
  const pending = pendingCharge();
  writePendingCharge(SCOPE, pending);
  expect(parsePendingCharge(readPendingChargeRaw(SCOPE))).toEqual(pending);
});

test("scopes stored charges by operator and booth", () => {
  const pending = pendingCharge();
  writePendingCharge(SCOPE, pending);

  expect(readPendingChargeRaw({ actorUid: "operator-2", boothId: "booth-1" })).toBeNull();
  expect(readPendingChargeRaw({ actorUid: "operator-1", boothId: "booth-2" })).toBeNull();
});

test("clearing removes the stored charge", () => {
  writePendingCharge(SCOPE, pendingCharge());
  clearPendingCharge(SCOPE);
  expect(readPendingChargeRaw(SCOPE)).toBeNull();
});

test("notifies subscribers when a charge is stored or cleared", () => {
  const listener = vi.fn();
  const unsubscribe = subscribePendingCharge(listener);

  writePendingCharge(SCOPE, pendingCharge());
  clearPendingCharge(SCOPE);
  unsubscribe();
  writePendingCharge(SCOPE, pendingCharge());

  expect(listener).toHaveBeenCalledTimes(2);
});

test("rejects unparsable or incomplete records rather than acting on them", () => {
  expect(parsePendingCharge(null)).toBeNull();
  expect(parsePendingCharge("{not json")).toBeNull();
  expect(parsePendingCharge(JSON.stringify({ key: "k" }))).toBeNull();
  expect(
    parsePendingCharge(JSON.stringify({ ...pendingCharge(), buyer: { nope: "x" } })),
  ).toBeNull();
  expect(
    parsePendingCharge(JSON.stringify({ ...pendingCharge(), items: [{ itemId: 1 }] })),
  ).toBeNull();
});

test("rejects a record whose cart is empty or has non-positive quantities", () => {
  expect(parsePendingCharge(JSON.stringify(pendingCharge({ items: [] })))).toBeNull();
  expect(
    parsePendingCharge(JSON.stringify(pendingCharge({ items: [{ itemId: "taco", qty: 0 }] }))),
  ).toBeNull();
  expect(
    parsePendingCharge(JSON.stringify(pendingCharge({ items: [{ itemId: "taco", qty: -2 }] }))),
  ).toBeNull();
  expect(
    parsePendingCharge(JSON.stringify(pendingCharge({ items: [{ itemId: "taco", qty: 1.5 }] }))),
  ).toBeNull();
});

test("drops a record older than the window it is allowed to surface in", () => {
  const startedAt = 1_000_000;
  const raw = JSON.stringify(pendingCharge({ startedAt }));

  expect(parsePendingCharge(raw, startedAt + PENDING_CHARGE_SHOW_WINDOW_MS)).not.toBeNull();
  expect(parsePendingCharge(raw, startedAt + PENDING_CHARGE_SHOW_WINDOW_MS + 1)).toBeNull();
});

test("rejects a record whose key is not a UUID v4, so it cannot wedge the POS", () => {
  expect(parsePendingCharge(JSON.stringify(pendingCharge({ key: "not-a-uuid" })))).toBeNull();
  expect(parsePendingCharge(JSON.stringify(pendingCharge({ key: "8f1d4a2e\n6b3c" })))).toBeNull();
});

test("expires a stored record mid-session once it outlives the show window", async () => {
  vi.useFakeTimers();
  try {
    const startedAt = Date.now() - (PENDING_CHARGE_SHOW_WINDOW_MS - 1_000);
    writePendingCharge(SCOPE, pendingCharge({ startedAt }));

    const { result } = renderHook(() => usePendingCharge(SCOPE));
    expect(result.current).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current).toBeNull();
    expect(readPendingChargeRaw(SCOPE)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("wakes subscribers on another tab's storage write", () => {
  const listener = vi.fn();
  const unsubscribe = subscribePendingCharge(listener);

  window.dispatchEvent(new StorageEvent("storage"));
  expect(listener).toHaveBeenCalledTimes(1);

  unsubscribe();
  window.dispatchEvent(new StorageEvent("storage"));
  expect(listener).toHaveBeenCalledTimes(1);
});
