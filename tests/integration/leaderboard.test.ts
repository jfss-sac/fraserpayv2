import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeLeaderboard } from "../../src/lib/server/leaderboard";
import { getBoothGrossCents, getBoothSummary } from "../../src/lib/server/dal";
import { type BoothDoc, type LedgerEntryDoc, boothsCol, ledgerCol } from "../../src/lib/server/db";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import type { BoothItem } from "../../src/lib/shared/types";

const RING = "lb-ring";
const BAKE = "lb-bake";
const QUIET = "lb-quiet";
const PENDING = "lb-pending";

const RING_ITEMS: BoothItem[] = [
  { id: "play", name: "Play", priceCents: 200, isCustom: false },
  { id: "prize", name: "Prize", priceCents: 500, isCustom: false },
];
const BAKE_ITEMS: BoothItem[] = [{ id: "cake", name: "Cake", priceCents: 300, isCustom: false }];

async function makeBooth(
  id: string,
  status: BoothDoc["status"],
  items: BoothItem[],
): Promise<void> {
  await boothsCol()
    .doc(id)
    .set({
      name: `Booth ${id}`,
      nameLower: `booth ${id}`,
      description: "test booth",
      status,
      items: items.map((i) => ({ ...i })),
      joinCode: status === "pending" ? null : "BOOT-4H8N5",
      submitterUid: "lb-exec",
      submitterEmail: "lb-exec@pdsb.net",
      createdAt: Timestamp.now(),
    });
}

let seq = 0;
async function seedEntry(overrides: Partial<LedgerEntryDoc>): Promise<string> {
  seq += 1;
  const entry: LedgerEntryDoc = {
    type: "purchase",
    amountCents: 0,
    direction: "debit",
    balanceAfterCents: 0,
    studentUid: "lb-student",
    studentNumber: "700001",
    studentName: "Seed Student",
    actorUid: "lb-member",
    actorName: "Ava Member",
    tags: [],
    idempotencyKey: `lb-seed-${seq}`,
    createdAt: Timestamp.fromMillis(Date.parse("2024-01-15T15:00:00Z") + seq * 1000),
    createdDate: "2024-01-15",
    ...overrides,
  };
  const ref = ledgerCol().doc();
  await ref.set(entry);
  return ref.id;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeBooth(RING, "approved", RING_ITEMS);
  await makeBooth(BAKE, "deactivated", BAKE_ITEMS);
  await makeBooth(QUIET, "approved", BAKE_ITEMS);
  await makeBooth(PENDING, "pending", RING_ITEMS);

  await seedEntry({
    type: "purchase",
    boothId: RING,
    boothName: `Booth ${RING}`,
    amountCents: 1100,
    lineItems: [
      { itemId: "play", name: "Play", qty: 3, unitPriceCents: 200 },
      { itemId: "prize", name: "Prize", qty: 1, unitPriceCents: 500 },
    ],
  });
  const ringP2 = await seedEntry({
    type: "purchase",
    boothId: RING,
    boothName: `Booth ${RING}`,
    amountCents: 400,
    lineItems: [{ itemId: "play", name: "Play", qty: 2, unitPriceCents: 200 }],
  });
  await seedEntry({
    type: "refund",
    direction: "credit",
    boothId: RING,
    boothName: `Booth ${RING}`,
    amountCents: 200,
    originalEntryId: ringP2,
    lineItems: [{ itemId: "play", name: "Play", qty: 1, unitPriceCents: 200 }],
  });

  await seedEntry({
    type: "purchase",
    boothId: BAKE,
    boothName: `Booth ${BAKE}`,
    amountCents: 600,
    lineItems: [{ itemId: "cake", name: "Cake", qty: 2, unitPriceCents: 300 }],
  });

  await seedEntry({
    type: "purchase",
    boothId: PENDING,
    boothName: `Booth ${PENDING}`,
    amountCents: 5000,
    lineItems: [{ itemId: "play", name: "Play", qty: 25, unitPriceCents: 200 }],
  });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("ledger"));
  await db.recursiveDelete(db.collection("booths"));
  vi.restoreAllMocks();
});

describe("computeLeaderboard — ranking (A6)", () => {
  it("ranks approved and deactivated booths by gross (purchases minus refunds)", async () => {
    const { rows } = await computeLeaderboard();

    expect(rows).toEqual([
      { rank: 1, boothId: RING, boothName: `Booth ${RING}`, grossCents: 1300 },
      { rank: 2, boothId: BAKE, boothName: `Booth ${BAKE}`, grossCents: 600 },
      { rank: 3, boothId: QUIET, boothName: `Booth ${QUIET}`, grossCents: 0 },
    ]);
  });

  it("excludes pending booths regardless of their ledger activity", async () => {
    const { rows } = await computeLeaderboard();
    expect(rows.some((r) => r.boothId === PENDING)).toBe(false);
  });

  it("matches the full-scan summary gross for every booth", async () => {
    for (const boothId of [RING, BAKE, QUIET, PENDING]) {
      const summary = await getBoothSummary(boothId);
      expect(await getBoothGrossCents(boothId)).toBe(summary!.grossCents);
    }
  });

  it("exposes no per-item breakdown", async () => {
    const { rows } = await computeLeaderboard();
    for (const row of rows) {
      expect(Object.keys(row)).toEqual(["rank", "boothId", "boothName", "grossCents"]);
    }
  });
});
