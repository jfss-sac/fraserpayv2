import { afterEach, expect, test } from "vitest";
import {
  type PendingTopUp,
  PENDING_TOPUP_SHOW_WINDOW_MS,
  clearPendingTopUp,
  parsePendingTopUp,
  parsePendingTopUps,
  prunePendingTopUps,
  readPendingTopUpsRaw,
  writePendingTopUp,
} from "./pending-topup";

const ACTOR = "sac-1";
const KEY_A = "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f";
const KEY_B = "1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d";

function pendingTopUp(overrides: Partial<PendingTopUp> = {}): PendingTopUp {
  return {
    key: KEY_A,
    sessionId: "session-1",
    buyer: { studentNumber: "123456" },
    studentName: "Ada Lovelace",
    amountCents: 1000,
    method: "cash",
    startedAt: Date.now(),
    ...overrides,
  };
}

function stored(actorUid = ACTOR, now = Date.now()): PendingTopUp[] {
  return parsePendingTopUps(readPendingTopUpsRaw(actorUid), now);
}

afterEach(() => {
  localStorage.clear();
});

test("round-trips a pending top-up through storage", () => {
  const pending = pendingTopUp();
  writePendingTopUp(ACTOR, pending);
  expect(stored()).toEqual([pending]);
});

test("keeps the override reason, so a retry replays the identical body", () => {
  const pending = pendingTopUp({ amountCents: 15_000, overrideReason: "principal approved" });
  writePendingTopUp(ACTOR, pending);
  expect(stored()[0]?.overrideReason).toBe("principal approved");
});

test("scopes stored top-ups to the member who rang them", () => {
  writePendingTopUp(ACTOR, pendingTopUp());
  expect(stored("sac-2")).toEqual([]);
});

test("keeps every unresolved top-up — a later one never evicts an earlier one", () => {
  writePendingTopUp(ACTOR, pendingTopUp({ key: KEY_A, startedAt: Date.now() - 1000 }));
  writePendingTopUp(ACTOR, pendingTopUp({ key: KEY_B }));

  expect(stored().map((record) => record.key)).toEqual([KEY_A, KEY_B]);
});

test("clearing removes only the named top-up", () => {
  writePendingTopUp(ACTOR, pendingTopUp({ key: KEY_A }));
  writePendingTopUp(ACTOR, pendingTopUp({ key: KEY_B }));

  clearPendingTopUp(ACTOR, KEY_A);

  expect(stored().map((record) => record.key)).toEqual([KEY_B]);
});

test("rejects records whose money fields are unusable rather than acting on them", () => {
  expect(parsePendingTopUp(JSON.stringify(pendingTopUp({ amountCents: 0 })))).toBeNull();
  expect(parsePendingTopUp(JSON.stringify(pendingTopUp({ amountCents: 10.5 })))).toBeNull();
  expect(parsePendingTopUp(JSON.stringify({ ...pendingTopUp(), method: "cheque" }))).toBeNull();
  expect(parsePendingTopUp(JSON.stringify({ ...pendingTopUp(), buyer: {} }))).toBeNull();
  expect(parsePendingTopUp(JSON.stringify({ ...pendingTopUp(), studentName: 7 }))).toBeNull();
  expect(parsePendingTopUp("not json")).toBeNull();
});

test("rejects a record whose key is not a UUID v4, so it cannot wedge the form", () => {
  expect(parsePendingTopUp(JSON.stringify(pendingTopUp({ key: "../../etc" })))).toBeNull();
});

test("drops a record older than the window it is allowed to surface in", () => {
  const stale = pendingTopUp({ startedAt: Date.now() - PENDING_TOPUP_SHOW_WINDOW_MS - 1 });
  writePendingTopUp(ACTOR, stale);

  expect(stored()).toEqual([]);
});

test("prunes records that are unreadable, expired, or filed under the wrong key", () => {
  const scopeKey = `fraserpay:pending-topup:${ACTOR}`;
  localStorage.setItem(`${scopeKey}:${KEY_A}`, "{ broken");
  localStorage.setItem(
    `${scopeKey}:${KEY_B}`,
    JSON.stringify(pendingTopUp({ key: KEY_A, sessionId: "session-2" })),
  );
  writePendingTopUp(ACTOR, pendingTopUp({ key: KEY_A }));

  prunePendingTopUps(ACTOR);

  expect(localStorage.getItem(`${scopeKey}:${KEY_B}`)).toBeNull();
  expect(stored()).toHaveLength(1);
});
