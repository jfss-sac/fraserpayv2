import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  type PendingCharge,
  PENDING_CHARGE_SHOW_WINDOW_MS,
  clearPendingCharge,
  parsePendingCharge,
  parsePendingCharges,
  prunePendingCharges,
  readPendingChargesRaw,
  subscribePendingCharge,
  usePendingCharges,
  writePendingCharge,
} from "./pending-charge";

const SCOPE = { actorUid: "operator-1", boothId: "booth-1" };
const LEGACY_KEY = "fraserpay:pending-charge:operator-1:booth-1";
const KEY_A = "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f";
const KEY_B = "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d";
const KEY_C = "9a8b7c6d-5e4f-4321-b987-6543210fedcb";

function pendingCharge(overrides: Partial<PendingCharge> = {}): PendingCharge {
  return {
    key: KEY_A,
    sessionId: "session-1",
    buyer: { studentNumber: "123456" },
    buyerName: "Ada Lovelace",
    items: [{ itemId: "taco", qty: 2 }],
    amountCents: 450,
    startedAt: Date.now(),
    ...overrides,
  };
}

function stored(scope = SCOPE, now = Date.now()): PendingCharge[] {
  return parsePendingCharges(readPendingChargesRaw(scope), now);
}

afterEach(() => {
  localStorage.clear();
});

test("round-trips a pending charge through storage", () => {
  const pending = pendingCharge();
  writePendingCharge(SCOPE, pending);
  expect(stored()).toEqual([pending]);
});

test("scopes stored charges by operator and booth", () => {
  writePendingCharge(SCOPE, pendingCharge());

  expect(stored({ actorUid: "operator-2", boothId: "booth-1" })).toEqual([]);
  expect(stored({ actorUid: "operator-1", boothId: "booth-2" })).toEqual([]);
});

test("does not adopt records from a booth whose id extends this one", () => {
  writePendingCharge({ actorUid: "operator-1", boothId: "booth-1:annex" }, pendingCharge());

  expect(stored()).toEqual([]);
});

test("clearing removes only the named charge", () => {
  const now = Date.now();
  writePendingCharge(SCOPE, pendingCharge({ key: KEY_A, startedAt: now - 2_000 }));
  writePendingCharge(SCOPE, pendingCharge({ key: KEY_B, startedAt: now - 1_000 }));

  clearPendingCharge(SCOPE, KEY_A);

  expect(stored().map((record) => record.key)).toEqual([KEY_B]);
});

test("keeps every unresolved charge — a later one never evicts an earlier one", () => {
  const now = Date.now();
  writePendingCharge(SCOPE, pendingCharge({ key: KEY_A, startedAt: now - 1_000 }));
  writePendingCharge(SCOPE, pendingCharge({ key: KEY_B, startedAt: now - 3_000 }));
  writePendingCharge(SCOPE, pendingCharge({ key: KEY_C, startedAt: now - 2_000 }));

  expect(stored().map((record) => record.key)).toEqual([KEY_B, KEY_C, KEY_A]);
});

test("reads a record left under the pre-migration single-slot key and clears it once resolved", () => {
  const legacy = pendingCharge({ key: KEY_A });
  localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
  writePendingCharge(SCOPE, pendingCharge({ key: KEY_B, startedAt: legacy.startedAt + 1_000 }));

  expect(stored().map((record) => record.key)).toEqual([KEY_A, KEY_B]);

  clearPendingCharge(SCOPE, KEY_A);

  expect(stored().map((record) => record.key)).toEqual([KEY_B]);
  expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
});

test("prunes records that are unreadable, expired, or filed under the wrong key", () => {
  const now = Date.now();
  localStorage.setItem(`${LEGACY_KEY}:${KEY_A}`, "{not json");
  localStorage.setItem(
    `${LEGACY_KEY}:${KEY_B}`,
    JSON.stringify(
      pendingCharge({ key: KEY_B, startedAt: now - PENDING_CHARGE_SHOW_WINDOW_MS - 1 }),
    ),
  );
  localStorage.setItem(`${LEGACY_KEY}:${KEY_C}`, JSON.stringify(pendingCharge({ key: KEY_A })));
  writePendingCharge(SCOPE, pendingCharge({ key: KEY_A, startedAt: now }));

  prunePendingCharges(SCOPE, now);

  expect(localStorage.getItem(`${LEGACY_KEY}:${KEY_B}`)).toBeNull();
  expect(localStorage.getItem(`${LEGACY_KEY}:${KEY_C}`)).toBeNull();
  expect(stored().map((record) => record.key)).toEqual([KEY_A]);
});

test("notifies subscribers when a charge is stored or cleared", () => {
  const listener = vi.fn();
  const unsubscribe = subscribePendingCharge(listener);

  writePendingCharge(SCOPE, pendingCharge());
  clearPendingCharge(SCOPE, KEY_A);
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

test("drops only the expired records from a set", () => {
  const now = Date.now();
  const fresh = pendingCharge({ key: KEY_A, startedAt: now });
  const stale = pendingCharge({ key: KEY_B, startedAt: now - PENDING_CHARGE_SHOW_WINDOW_MS - 1 });

  expect(parsePendingCharges([stale, fresh].map((r) => JSON.stringify(r)).join("\n"), now)).toEqual(
    [fresh],
  );
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

    const { result } = renderHook(() => usePendingCharges(SCOPE));
    expect(result.current).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current).toEqual([]);
    expect(readPendingChargesRaw(SCOPE)).toBe("");
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
