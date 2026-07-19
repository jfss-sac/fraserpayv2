import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { boothsCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { type IdempotencyContext, requestHash } from "../../src/lib/server/idempotency";
import { adjustBalance } from "../../src/lib/server/money/adjust";
import { charge } from "../../src/lib/server/money/charge";
import { refundPurchase } from "../../src/lib/server/money/refund";
import { topUp } from "../../src/lib/server/money/topup";
import type { BoothItem } from "../../src/lib/shared/types";
import { verifyLedger } from "../../scripts/verify-ledger";

const OPERATOR = { uid: "vl-operator", name: "Ollie Operator" };
const EXEC = { uid: "vl-exec", name: "Xena Exec" };
const BOOTH_ID = "vl-booth";

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false },
];

let keySeq = 0;
function idempotency(actorUid: string, endpoint: string, body: unknown): IdempotencyContext {
  keySeq += 1;
  const key = `vl-key-${keySeq}`;
  return { key, actorUid, endpoint, docId: `${actorUid}_${key}`, requestHash: requestHash(body) };
}

async function makeUser(args: {
  uid: string;
  displayName: string;
  studentNumber?: string | null;
  paymentCode: string;
}): Promise<void> {
  await usersCol()
    .doc(args.uid)
    .set({
      email: `${args.uid}@pdsb.net`,
      displayName: args.displayName,
      displayNameLower: args.displayName.toLowerCase(),
      studentNumber: args.studentNumber ?? null,
      paymentCode: args.paymentCode,
      balanceCents: 0,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

let studentSeq = 0;
async function freshStudent(): Promise<{
  uid: string;
  studentNumber: string;
  paymentCode: string;
}> {
  studentSeq += 1;
  const uid = `vl-student-${studentSeq}`;
  const studentNumber = `9300${studentSeq.toString().padStart(2, "0")}`;
  const paymentCode = `vl1-STU${studentSeq.toString().padStart(3, "0")}`;
  await makeUser({ uid, displayName: `Student ${studentSeq}`, studentNumber, paymentCode });
  return { uid, studentNumber, paymentCode };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({ uid: OPERATOR.uid, displayName: OPERATOR.name, paymentCode: "vl1-OPER" });
  await makeUser({ uid: EXEC.uid, displayName: EXEC.name, paymentCode: "vl1-EXEC" });
  await boothsCol()
    .doc(BOOTH_ID)
    .set({
      name: "Verify Booth",
      nameLower: "verify booth",
      description: "test booth",
      status: "approved",
      items: ITEMS,
      joinCode: "VL-001",
      submitterUid: OPERATOR.uid,
      submitterEmail: `${OPERATOR.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
  await membersCol(BOOTH_ID)
    .doc(OPERATOR.uid)
    .set({ uid: OPERATOR.uid, displayName: OPERATOR.name, joinedAt: Timestamp.now() });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "idempotency", "rateLimits"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  await db.recursiveDelete(db.collection("booths"));
  vi.restoreAllMocks();
});

describe("verify-ledger", () => {
  it("reconciles balances and points across topup, purchase, refund, and adjustment", async () => {
    const student = await freshStudent();
    const other = await freshStudent();

    await topUp({
      input: { buyer: { studentNumber: student.studentNumber }, amountCents: 5000, method: "cash" },
      actor: { uid: EXEC.uid, displayName: EXEC.name, isExec: true },
      idempotency: idempotency(EXEC.uid, "/api/sac/topup", { s: student.uid, a: 5000 }),
    });
    const topupOther = await topUp({
      input: { buyer: { studentNumber: other.studentNumber }, amountCents: 1050, method: "card" },
      actor: { uid: EXEC.uid, displayName: EXEC.name, isExec: true },
      idempotency: idempotency(EXEC.uid, "/api/sac/topup", { s: other.uid, a: 1050 }),
    });

    const purchase = await charge({
      input: {
        boothId: BOOTH_ID,
        buyer: { studentNumber: student.studentNumber },
        items: [
          { itemId: "coffee", qty: 2 },
          { itemId: "cookie", qty: 1 },
        ],
      },
      actor: { uid: OPERATOR.uid, displayName: OPERATOR.name },
      idempotency: idempotency(OPERATOR.uid, "/api/booth/charge", { s: student.uid }),
    });

    await refundPurchase({
      input: { originalEntryId: purchase.entryId, reason: "verify-ledger refund" },
      actor: { uid: EXEC.uid, displayName: EXEC.name },
      idempotency: idempotency(EXEC.uid, "/api/exec/refund", { e: purchase.entryId }),
    });

    await adjustBalance({
      input: {
        studentUid: other.uid,
        amountCents: -500,
        reason: "verify-ledger reversal",
        originalEntryId: topupOther.entryId,
      },
      actor: { uid: EXEC.uid, displayName: EXEC.name },
      idempotency: idempotency(EXEC.uid, "/api/exec/adjust", { s: other.uid, linked: true }),
    });
    await adjustBalance({
      input: { studentUid: student.uid, amountCents: 100, reason: "verify-ledger credit" },
      actor: { uid: EXEC.uid, displayName: EXEC.name },
      idempotency: idempotency(EXEC.uid, "/api/exec/adjust", { s: student.uid, linked: false }),
    });

    const report = await verifyLedger(getAdminFirestore(), {
      onlyUids: [student.uid, other.uid, OPERATOR.uid, EXEC.uid],
    });

    expect(report.ok).toBe(true);
    expect(report.divergences).toEqual([]);
    expect(report.ledgerEntries).toBeGreaterThanOrEqual(5);
  });

  it("catches a balance corrupted by a raw admin write", async () => {
    const student = await freshStudent();
    await topUp({
      input: { buyer: { studentNumber: student.studentNumber }, amountCents: 2000, method: "cash" },
      actor: { uid: EXEC.uid, displayName: EXEC.name, isExec: true },
      idempotency: idempotency(EXEC.uid, "/api/sac/topup", { s: student.uid, a: 2000 }),
    });

    expect((await verifyLedger(getAdminFirestore(), { onlyUids: [student.uid] })).ok).toBe(true);

    await usersCol().doc(student.uid).update({ balanceCents: 999999 });

    const report = await verifyLedger(getAdminFirestore(), { onlyUids: [student.uid] });
    expect(report.ok).toBe(false);
    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0]).toMatchObject({
      uid: student.uid,
      userExists: true,
      expectedBalanceCents: 2000,
      actualBalanceCents: 999999,
    });

    await usersCol().doc(student.uid).update({ balanceCents: 2000 });
    expect((await verifyLedger(getAdminFirestore(), { onlyUids: [student.uid] })).ok).toBe(true);
  });

  it("catches corrupted points", async () => {
    const student = await freshStudent();
    await topUp({
      input: { buyer: { studentNumber: student.studentNumber }, amountCents: 1050, method: "cash" },
      actor: { uid: EXEC.uid, displayName: EXEC.name, isExec: true },
      idempotency: idempotency(EXEC.uid, "/api/sac/topup", { s: student.uid, a: 1050 }),
    });

    await usersCol().doc(student.uid).update({ points: 0 });

    const report = await verifyLedger(getAdminFirestore(), { onlyUids: [student.uid] });
    expect(report.ok).toBe(false);
    expect(report.divergences[0]).toMatchObject({
      uid: student.uid,
      expectedPoints: 52.5,
      actualPoints: 0,
    });

    await usersCol().doc(student.uid).update({ points: 52.5 });
  });
});
