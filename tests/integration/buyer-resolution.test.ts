import { type DocumentReference, type Transaction, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type UserDoc, usersCol } from "../../src/lib/server/db";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { resolveActiveBuyer } from "../../src/lib/server/money/shared";

let buyerSeq = 0;

async function freshBuyer(overrides: { suspended?: boolean } = {}): Promise<{
  uid: string;
  studentNumber: string;
  paymentCode: string;
}> {
  buyerSeq += 1;
  const uid = `resolve-buyer-${buyerSeq}`;
  const studentNumber = `9300${buyerSeq.toString().padStart(2, "0")}`;
  const paymentCode = `fp1-RES${buyerSeq.toString().padStart(3, "0")}`;
  await usersCol()
    .doc(uid)
    .set({
      email: `${uid}@pdsb.net`,
      displayName: `Buyer ${buyerSeq}`,
      displayNameLower: `buyer ${buyerSeq}`,
      studentNumber,
      paymentCode,
      balanceCents: 2000,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: overrides.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  return { uid, studentNumber, paymentCode };
}

// resolveActiveBuyer resolves the uid with a query and then reads that one
// document through the transaction. Revocation races land in the gap between
// those two reads, which this stub opens to an arbitrary width.
function transactionReadingAfter(hook: () => Promise<void>): Transaction {
  return {
    get: async (ref: DocumentReference<UserDoc>) => {
      await hook();
      return ref.get();
    },
  } as unknown as Transaction;
}

const noop = async (): Promise<void> => {};

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("users"));
  vi.restoreAllMocks();
});

describe("resolveActiveBuyer identifier re-check", () => {
  it("resolves a buyer whose payment code is unchanged", async () => {
    const buyer = await freshBuyer();
    const resolved = await resolveActiveBuyer(transactionReadingAfter(noop), {
      paymentCode: buyer.paymentCode,
    });
    expect(resolved.uid).toBe(buyer.uid);
    expect(resolved.data.paymentCode).toBe(buyer.paymentCode);
  });

  it("refuses a payment code regenerated between the lookup and the transactional read", async () => {
    const buyer = await freshBuyer();
    const rotate = async (): Promise<void> => {
      await usersCol()
        .doc(buyer.uid)
        .update({ paymentCode: `${buyer.paymentCode}-R`, updatedAt: Timestamp.now() });
    };

    await expect(
      resolveActiveBuyer(transactionReadingAfter(rotate), { paymentCode: buyer.paymentCode }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a student number reassigned between the lookup and the transactional read", async () => {
    const buyer = await freshBuyer();
    const reassign = async (): Promise<void> => {
      await usersCol()
        .doc(buyer.uid)
        .update({ studentNumber: `${buyer.studentNumber}9`, updatedAt: Timestamp.now() });
    };

    await expect(
      resolveActiveBuyer(transactionReadingAfter(reassign), {
        studentNumber: buyer.studentNumber,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports a revoked code as NOT_FOUND rather than disclosing suspension", async () => {
    const buyer = await freshBuyer({ suspended: true });
    const rotate = async (): Promise<void> => {
      await usersCol()
        .doc(buyer.uid)
        .update({ paymentCode: `${buyer.paymentCode}-R`, updatedAt: Timestamp.now() });
    };

    await expect(
      resolveActiveBuyer(transactionReadingAfter(rotate), { paymentCode: buyer.paymentCode }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("still rejects a suspended buyer whose code is intact", async () => {
    const buyer = await freshBuyer({ suspended: true });
    await expect(
      resolveActiveBuyer(transactionReadingAfter(noop), { paymentCode: buyer.paymentCode }),
    ).rejects.toMatchObject({ code: "SUSPENDED" });
  });
});
