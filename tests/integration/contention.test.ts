import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type LedgerEntryDoc,
  boothsCol,
  ledgerCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import type { AppError } from "../../src/lib/server/errors";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { type IdempotencyContext, requestHash } from "../../src/lib/server/idempotency";
import { charge } from "../../src/lib/server/money/charge";
import { topUp } from "../../src/lib/server/money/topup";
import type { BoothItem } from "../../src/lib/shared/types";
import { verifyLedger } from "../../scripts/verify-ledger";

const OPERATOR = { uid: "con-operator", name: "Otis Operator" };
const EXEC = { uid: "con-exec", name: "Xander Exec" };
const BOOTH_ID = "con-booth";

const COFFEE_CENTS = 250;
const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: COFFEE_CENTS, isCustom: false },
];

let keySeq = 0;
function idempotency(actorUid: string, endpoint: string, body: unknown): IdempotencyContext {
  keySeq += 1;
  const key = `con-key-${keySeq}`;
  return { key, actorUid, endpoint, docId: `${actorUid}_${key}`, requestHash: requestHash(body) };
}

async function makeUser(args: {
  uid: string;
  displayName: string;
  studentNumber: string;
  paymentCode: string;
}): Promise<void> {
  await usersCol()
    .doc(args.uid)
    .set({
      email: `${args.uid}@pdsb.net`,
      displayName: args.displayName,
      displayNameLower: args.displayName.toLowerCase(),
      studentNumber: args.studentNumber,
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
  const uid = `con-student-${studentSeq}`;
  const studentNumber = String(9_510_000 + studentSeq);
  const paymentCode = `con-STU${studentSeq.toString().padStart(4, "0")}`;
  await makeUser({ uid, displayName: `Student ${studentSeq}`, studentNumber, paymentCode });
  return { uid, studentNumber, paymentCode };
}

async function fund(studentNumber: string, amountCents: number): Promise<void> {
  await topUp({
    input: { buyer: { studentNumber }, amountCents, method: "cash" },
    actor: { uid: EXEC.uid, displayName: EXEC.name, isExec: true },
    idempotency: idempotency(EXEC.uid, "/api/sac/topup", { studentNumber, amountCents }),
  });
}

function chargeCoffee(studentNumber: string, qty: number, ctx?: IdempotencyContext) {
  const input = { boothId: BOOTH_ID, buyer: { studentNumber }, items: [{ itemId: "coffee", qty }] };
  return charge({
    input,
    actor: { uid: OPERATOR.uid, displayName: OPERATOR.name },
    idempotency: ctx ?? idempotency(OPERATOR.uid, "/api/booth/charge", input),
  });
}

async function ledgerFor(uid: string): Promise<LedgerEntryDoc[]> {
  return (await ledgerCol().where("studentUid", "==", uid).get()).docs.map((d) => d.data());
}

async function balanceOf(uid: string): Promise<number> {
  return (await usersCol().doc(uid).get()).data()!.balanceCents;
}

function codeOf(reason: unknown): string | undefined {
  return (reason as Partial<AppError> | undefined)?.code;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: OPERATOR.uid,
    displayName: OPERATOR.name,
    studentNumber: "9500000",
    paymentCode: "con-OPER",
  });
  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    studentNumber: "9500001",
    paymentCode: "con-EXEC",
  });
  await boothsCol()
    .doc(BOOTH_ID)
    .set({
      name: "Contention Booth",
      nameLower: "contention booth",
      description: "test booth",
      status: "approved",
      items: ITEMS,
      joinCode: "CON-001",
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

describe("money contention", () => {
  it("lets exactly floor(balance/price) of N parallel charges win, the rest reject cleanly", async () => {
    const N = 8;
    const fundedCents = 3 * COFFEE_CENTS;
    const expectedWinners = Math.floor(fundedCents / COFFEE_CENTS);

    for (let round = 0; round < 20; round += 1) {
      const buyer = await freshStudent();
      await fund(buyer.studentNumber, fundedCents);

      const settled = await Promise.allSettled(
        Array.from({ length: N }, () => chargeCoffee(buyer.studentNumber, 1)),
      );

      const won = settled.filter((r) => r.status === "fulfilled");
      const lost = settled.filter((r) => r.status === "rejected");
      expect(won).toHaveLength(expectedWinners);
      expect(lost).toHaveLength(N - expectedWinners);
      for (const r of lost) {
        expect(codeOf((r as PromiseRejectedResult).reason)).toBe("INSUFFICIENT_FUNDS");
      }

      expect(await balanceOf(buyer.uid)).toBe(0);
      const purchases = (await ledgerFor(buyer.uid)).filter((e) => e.type === "purchase");
      expect(purchases).toHaveLength(expectedWinners);

      const report = await verifyLedger(getAdminFirestore(), { onlyUids: [buyer.uid] });
      expect(report.ok).toBe(true);
    }
  }, 120_000);

  it("keeps a simultaneous top-up and charge on one balance consistent", async () => {
    for (let round = 0; round < 20; round += 1) {
      const buyer = await freshStudent();
      await fund(buyer.studentNumber, 1000);

      const [topUpRes, chargeRes] = await Promise.allSettled([
        fund(buyer.studentNumber, 5000),
        chargeCoffee(buyer.studentNumber, 1),
      ]);
      expect(topUpRes.status).toBe("fulfilled");
      expect(chargeRes.status).toBe("fulfilled");

      expect(await balanceOf(buyer.uid)).toBe(1000 + 5000 - COFFEE_CENTS);
      expect(await ledgerFor(buyer.uid)).toHaveLength(3);

      const report = await verifyLedger(getAdminFirestore(), { onlyUids: [buyer.uid] });
      expect(report.ok).toBe(true);
    }
  }, 120_000);

  it("executes parallel identical-key charges exactly once (idempotency race)", async () => {
    for (let round = 0; round < 20; round += 1) {
      const buyer = await freshStudent();
      await fund(buyer.studentNumber, 1000);

      const ctx = idempotency(OPERATOR.uid, "/api/booth/charge", {
        boothId: BOOTH_ID,
        buyer: { studentNumber: buyer.studentNumber },
        items: [{ itemId: "coffee", qty: 1 }],
      });
      const [a, b] = await Promise.all([
        chargeCoffee(buyer.studentNumber, 1, ctx),
        chargeCoffee(buyer.studentNumber, 1, ctx),
      ]);

      expect(a).toEqual(b);
      expect(await balanceOf(buyer.uid)).toBe(1000 - COFFEE_CENTS);
      expect((await ledgerFor(buyer.uid)).filter((e) => e.type === "purchase")).toHaveLength(1);

      const report = await verifyLedger(getAdminFirestore(), { onlyUids: [buyer.uid] });
      expect(report.ok).toBe(true);
    }
  }, 120_000);

  it("reconciles the ledger after a mixed op storm across many users", async () => {
    for (let storm = 0; storm < 3; storm += 1) {
      const students = await Promise.all(Array.from({ length: 10 }, () => freshStudent()));
      const uids = students.map((s) => s.uid);
      await Promise.all(students.map((s) => fund(s.studentNumber, 5000)));

      const entriesBefore = new Map<string, number>();
      for (const s of students) entriesBefore.set(s.uid, (await ledgerFor(s.uid)).length);

      const ops: Array<() => Promise<unknown>> = [];
      for (let i = 0; i < 50; i += 1) {
        const s = students[i % 10]!;
        ops.push(
          i % 2 === 0 ? () => fund(s.studentNumber, 50) : () => chargeCoffee(s.studentNumber, 1),
        );
      }
      const settled = await Promise.allSettled(ops.map((op) => op()));
      const committed = settled.filter((r) => r.status === "fulfilled").length;

      let entriesAdded = 0;
      for (const s of students) {
        entriesAdded += (await ledgerFor(s.uid)).length - entriesBefore.get(s.uid)!;
      }
      expect(entriesAdded).toBe(committed);

      const report = await verifyLedger(getAdminFirestore(), { onlyUids: uids });
      expect(report.ok).toBe(true);
      expect(report.divergences).toEqual([]);
    }
  }, 180_000);
});
