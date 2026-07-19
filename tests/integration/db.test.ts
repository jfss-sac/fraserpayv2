import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuditLogDoc,
  auditCol,
  type BoothDoc,
  boothsCol,
  type IdempotencyDoc,
  idempotencyCol,
  type LedgerEntryDoc,
  ledgerCol,
  type MemberDoc,
  membersCol,
  type RateLimitDoc,
  rateLimitsCol,
  type UserDoc,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";

const now = Timestamp.fromMillis(1_700_000_000_000);
const later = Timestamp.fromMillis(1_700_000_100_000);

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (run via emulators:exec).");
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "booths", "ledger", "auditLog", "idempotency", "rateLimits"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
});

describe("Firestore converters round-trip through the emulator", () => {
  it("users", async () => {
    const model: UserDoc = {
      email: "843901@pdsb.net",
      displayName: "Ava Nguyen",
      displayNameLower: "ava nguyen",
      studentNumber: "843901",
      paymentCode: "fp1-ABCDEF",
      balanceCents: 5000,
      points: 250,
      roles: { sacMember: true, sacExec: false },
      suspended: false,
      createdAt: now,
      updatedAt: later,
    };
    await usersCol().doc("u1").set(model);
    expect((await usersCol().doc("u1").get()).data()).toEqual(model);
  });

  it("users with a null student number (teacher pattern)", async () => {
    const model: UserDoc = {
      email: "jmurray@pdsb.net",
      displayName: "Jordan Murray",
      displayNameLower: "jordan murray",
      studentNumber: null,
      paymentCode: "fp1-GHJKMN",
      balanceCents: 0,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: now,
      updatedAt: now,
    };
    await usersCol().doc("u2").set(model);
    const read = (await usersCol().doc("u2").get()).data();
    expect(read?.studentNumber).toBeNull();
    expect(read).toEqual(model);
  });

  it("booths (pending, no approval fields)", async () => {
    const model: BoothDoc = {
      name: "Taco Stand",
      nameLower: "taco stand",
      description: "Fresh tacos.",
      status: "pending",
      items: [{ id: "custom", name: "Custom", priceCents: 50, isCustom: true }],
      joinCode: null,
      submitterUid: "u2",
      submitterEmail: "jmurray@pdsb.net",
      createdAt: now,
    };
    await boothsCol().doc("b1").set(model);
    const read = (await boothsCol().doc("b1").get()).data();
    expect(read).toEqual(model);
    expect(read?.approvedAt).toBeUndefined();
    expect(read?.approvedByUid).toBeUndefined();
  });

  it("booths (approved, with approval fields)", async () => {
    const model: BoothDoc = {
      name: "Pizza Palace",
      nameLower: "pizza palace",
      description: "Slices.",
      status: "approved",
      items: [
        { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
        { id: "slice", name: "Slice", priceCents: 300, isCustom: false },
      ],
      joinCode: "PIZZA-9K1",
      submitterUid: "u2",
      submitterEmail: "jmurray@pdsb.net",
      createdAt: now,
      approvedAt: later,
      approvedByUid: "exec1",
    };
    await boothsCol().doc("b2").set(model);
    expect((await boothsCol().doc("b2").get()).data()).toEqual(model);
  });

  it("members (subcollection accessor)", async () => {
    const model: MemberDoc = { uid: "u1", displayName: "Ava Nguyen", joinedAt: now };
    await membersCol("b2").doc("u1").set(model);
    expect((await membersCol("b2").doc("u1").get()).data()).toEqual(model);
  });

  it("ledger (purchase with all optional fields present)", async () => {
    const model: LedgerEntryDoc = {
      type: "purchase",
      amountCents: 600,
      direction: "debit",
      balanceAfterCents: 4400,
      studentUid: "u1",
      studentNumber: "843901",
      studentName: "Ava Nguyen",
      actorUid: "u1",
      actorName: "Ava Nguyen",
      tags: ["high-amount"],
      idempotencyKey: "key-1",
      createdAt: now,
      createdDate: "2026-07-19",
      boothId: "b2",
      boothName: "Pizza Palace",
      lineItems: [{ itemId: "slice", name: "Slice", qty: 2, unitPriceCents: 300 }],
      originalEntryId: "orig-1",
      reason: "correction",
      method: "cash",
      pointsDelta: 0,
    };
    await ledgerCol().doc("l1").set(model);
    expect((await ledgerCol().doc("l1").get()).data()).toEqual(model);
  });

  it("ledger (topup with optional fields omitted — no undefined persisted)", async () => {
    const model: LedgerEntryDoc = {
      type: "topup",
      amountCents: 5000,
      direction: "credit",
      balanceAfterCents: 5000,
      studentUid: "u1",
      studentNumber: "843901",
      studentName: "Ava Nguyen",
      actorUid: "member1",
      actorName: "Sam Lee",
      tags: [],
      idempotencyKey: "key-2",
      createdAt: now,
      createdDate: "2026-07-19",
      method: "cash",
      pointsDelta: 250,
    };
    await ledgerCol().doc("l2").set(model);
    const read = (await ledgerCol().doc("l2").get()).data();
    expect(read).toEqual(model);
    expect(read).not.toHaveProperty("boothId");
    expect(read).not.toHaveProperty("lineItems");
    expect(read).not.toHaveProperty("originalEntryId");
  });

  it("auditLog", async () => {
    const model: AuditLogDoc = {
      action: "booth.approve",
      actorUid: "exec1",
      actorName: "Riley Kim",
      targetType: "booth",
      targetId: "b2",
      targetLabel: "Pizza Palace",
      details: { joinCode: "PIZZA-9K1" },
      createdAt: now,
    };
    await auditCol().doc("a1").set(model);
    expect((await auditCol().doc("a1").get()).data()).toEqual(model);
  });

  it("idempotency (with and without ledgerEntryId)", async () => {
    const linked: IdempotencyDoc = {
      actorUid: "member1",
      endpoint: "/api/sac/topup",
      requestHash: "abc123",
      responseJson: '{"entryId":"l2"}',
      createdAt: now,
      expiresAt: later,
      ledgerEntryId: "l2",
    };
    await idempotencyCol().doc("member1_key-2").set(linked);
    expect((await idempotencyCol().doc("member1_key-2").get()).data()).toEqual(linked);

    const unlinked: IdempotencyDoc = {
      actorUid: "member1",
      endpoint: "/api/booths/join",
      requestHash: "def456",
      responseJson: '{"ok":true}',
      createdAt: now,
      expiresAt: later,
    };
    await idempotencyCol().doc("member1_key-3").set(unlinked);
    const read = (await idempotencyCol().doc("member1_key-3").get()).data();
    expect(read).toEqual(unlinked);
    expect(read).not.toHaveProperty("ledgerEntryId");
  });

  it("rateLimits", async () => {
    const model: RateLimitDoc = { count: 3, expiresAt: later };
    await rateLimitsCol().doc("topup_member1_1700000000").set(model);
    expect((await rateLimitsCol().doc("topup_member1_1700000000").get()).data()).toEqual(model);
  });
});
