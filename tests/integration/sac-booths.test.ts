import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getBoothDetail, listBooths } from "../../src/lib/server/sac-booths";
import { boothsCol, ledgerCol, membersCol } from "../../src/lib/server/db";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import type { BoothItem, BoothStatus } from "../../src/lib/shared/types";

const PREFIX = "sacb-";
const SUBMITTER = "jmurray@pdsb.net";

const ITEMS: BoothItem[] = [
  { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
  { id: "slice", name: "Slice", priceCents: 300, isCustom: false },
  { id: "pie", name: "Whole Pie", priceCents: 1500, isCustom: false },
];

async function makeBooth(args: {
  id: string;
  name: string;
  status: BoothStatus;
  joinCode: string | null;
}): Promise<void> {
  await boothsCol()
    .doc(args.id)
    .set({
      name: args.name,
      nameLower: args.name.toLowerCase(),
      description: "test booth",
      status: args.status,
      items: ITEMS.map((i) => ({ ...i })),
      joinCode: args.joinCode,
      submitterUid: "teacher-uid",
      submitterEmail: SUBMITTER,
      createdAt: Timestamp.now(),
      ...(args.status === "pending" ? {} : { approvedAt: Timestamp.now() }),
    });
}

async function addMember(boothId: string, uid: string, displayName: string): Promise<void> {
  await membersCol(boothId).doc(uid).set({ uid, displayName, joinedAt: Timestamp.now() });
}

let ledgerSeq = 0;
async function addPurchase(boothId: string, boothName: string): Promise<void> {
  ledgerSeq += 1;
  await ledgerCol()
    .doc(`${PREFIX}ledger-${ledgerSeq}`)
    .set({
      type: "purchase",
      amountCents: 600,
      direction: "debit",
      balanceAfterCents: 0,
      studentUid: `${PREFIX}buyer`,
      studentNumber: "999999",
      studentName: "Buyer",
      actorUid: `${PREFIX}buyer`,
      actorName: "Buyer",
      tags: [],
      idempotencyKey: `${PREFIX}ledger-${ledgerSeq}`,
      createdAt: Timestamp.now(),
      createdDate: "2026-07-20",
      boothId,
      boothName,
      lineItems: [{ itemId: "slice", name: "Slice", qty: 2, unitPriceCents: 300 }],
    });
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeBooth({
    id: `${PREFIX}deact`,
    name: "Candy Corner",
    status: "deactivated",
    joinCode: "CANDY-2X8",
  });
  await makeBooth({
    id: `${PREFIX}pending`,
    name: "Taco Stand",
    status: "pending",
    joinCode: null,
  });
  await makeBooth({
    id: `${PREFIX}approved`,
    name: "Pizza Palace",
    status: "approved",
    joinCode: "PIZZA-9K1",
  });

  await addMember(`${PREFIX}approved`, `${PREFIX}m2`, "Sam Lee");
  await addMember(`${PREFIX}approved`, `${PREFIX}m1`, "Ava Nguyen");
  await addPurchase(`${PREFIX}approved`, "Pizza Palace");
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("booths"));
  const stale = await ledgerCol().where("studentUid", "==", `${PREFIX}buyer`).get();
  await Promise.all(stale.docs.map((d) => d.ref.delete()));
  vi.restoreAllMocks();
});

describe("listBooths", () => {
  it("orders pending first, then approved, then deactivated, and carries submitter + code", async () => {
    const mine = (await listBooths()).filter((b) => b.id.startsWith(PREFIX));
    expect(mine.map((b) => b.id)).toEqual([
      `${PREFIX}pending`,
      `${PREFIX}approved`,
      `${PREFIX}deact`,
    ]);
    const pending = mine.find((b) => b.id === `${PREFIX}pending`)!;
    expect(pending.submitterEmail).toBe(SUBMITTER);
    expect(pending.joinCode).toBeNull();
    expect(mine.find((b) => b.id === `${PREFIX}approved`)!.joinCode).toBe("PIZZA-9K1");
  });
});

describe("getBoothDetail", () => {
  it("returns a pending booth with the submitter email and no sales summary", async () => {
    const detail = (await getBoothDetail(`${PREFIX}pending`))!;
    expect(detail.status).toBe("pending");
    expect(detail.submitterEmail).toBe(SUBMITTER);
    expect(detail.members).toEqual([]);
    expect(detail.summary).toBeNull();
    expect(detail.items.map((i) => i.name)).toContain("Slice");
  });

  it("returns members sorted by name and a reconciled sales summary for an approved booth", async () => {
    const detail = (await getBoothDetail(`${PREFIX}approved`))!;
    expect(detail.joinCode).toBe("PIZZA-9K1");
    expect(detail.members.map((m) => m.displayName)).toEqual(["Ava Nguyen", "Sam Lee"]);
    expect(detail.summary).not.toBeNull();
    expect(detail.summary!.grossCents).toBe(600);
    expect(detail.summary!.purchaseCount).toBe(1);
    expect(detail.summary!.items).toEqual([
      { itemId: "slice", name: "Slice", qty: 2, revenueCents: 600 },
    ]);
  });

  it("returns null for a booth that does not exist", async () => {
    expect(await getBoothDetail(`${PREFIX}nope`)).toBeNull();
  });
});
