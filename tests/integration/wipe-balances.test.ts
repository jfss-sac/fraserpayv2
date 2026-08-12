import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { parseArgs, resolveWipePlan, wipeBalances } from "../../scripts/wipe-balances";

const PROJECT = "demo-fraserpay";

const ALICE = { uid: "wipe-alice", balanceCents: 5000, points: 120 };
const BOB = { uid: "wipe-bob", balanceCents: 250, points: 3 };
const CARE = { uid: "wipe-zero", balanceCents: 0, points: 40 };
const LEDGER_ID = "wipe-ledger-1";
const MULTI_BATCH_USERS = Array.from({ length: 451 }, (_, index) => ({
  uid: `wipe-batch-${index.toString().padStart(3, "0")}`,
  balanceCents: 50,
}));
const LATE_CREDIT_UID = "wipe-late-credit";
const STALE_BATCH_UID = "wipe-stale-batch";

async function seed(): Promise<void> {
  const db = getAdminFirestore();
  const now = FieldValue.serverTimestamp();
  for (const u of [ALICE, BOB, CARE]) {
    await db
      .collection("users")
      .doc(u.uid)
      .set({
        email: `${u.uid}@pdsb.net`,
        displayName: u.uid,
        displayNameLower: u.uid,
        studentNumber: null,
        paymentCode: u.uid,
        balanceCents: u.balanceCents,
        points: u.points,
        roles: { sacMember: false, sacExec: false },
        suspended: false,
        createdAt: now,
        updatedAt: now,
      });
  }
  await db.collection("ledger").doc(LEDGER_ID).set({
    type: "topup",
    amountCents: 5000,
    direction: "credit",
    balanceAfterCents: 5000,
    studentUid: ALICE.uid,
    studentNumber: null,
    studentName: ALICE.uid,
    actorUid: "sac-1",
    actorName: "SAC",
    tags: [],
    idempotencyKey: "wipe-seed",
    createdAt: now,
    createdDate: "2026-07-29",
  });
}

async function seedMultiBatchUsers(): Promise<void> {
  const db = getAdminFirestore();
  const batch = db.batch();
  for (const user of MULTI_BATCH_USERS) {
    batch.set(db.collection("users").doc(user.uid), {
      balanceCents: user.balanceCents,
      points: 0,
    });
  }
  batch.set(db.collection("users").doc(LATE_CREDIT_UID), { balanceCents: 0, points: 0 });
  batch.set(db.collection("users").doc(STALE_BATCH_UID), { balanceCents: 50, points: 0 });
  await batch.commit();
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (run via emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  await seed();
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("users"));
  await db.recursiveDelete(db.collection("ledger"));
  await db.recursiveDelete(db.collection("operations"));
  vi.restoreAllMocks();
});

describe("wipe-balances guard rails", () => {
  const emulator = true;

  it("aborts when --project is missing", () => {
    const plan = resolveWipePlan(parseArgs(["--confirm", PROJECT, "--i-have-exported"]), emulator);
    expect(plan.proceed).toBe(false);
  });

  it("aborts when --confirm is missing", () => {
    const plan = resolveWipePlan(parseArgs(["--project", PROJECT, "--i-have-exported"]), emulator);
    expect(plan.proceed).toBe(false);
  });

  it("aborts when --confirm does not match --project", () => {
    const plan = resolveWipePlan(
      parseArgs(["--project", PROJECT, "--confirm", "wrong-id", "--i-have-exported"]),
      emulator,
    );
    expect(plan.proceed).toBe(false);
    if (!plan.proceed) expect(plan.reason).toMatch(/did not match/i);
  });

  it("aborts without the --i-have-exported export gate", () => {
    const plan = resolveWipePlan(parseArgs(["--project", PROJECT, "--confirm", PROJECT]), emulator);
    expect(plan.proceed).toBe(false);
    if (!plan.proceed) expect(plan.reason).toMatch(/i-have-exported/i);
  });

  it("aborts when emulator vars would redirect a cloud project id", () => {
    const plan = resolveWipePlan(
      parseArgs([
        "--project",
        "fraserpay-prod",
        "--confirm",
        "fraserpay-prod",
        "--i-have-exported",
      ]),
      emulator,
    );
    expect(plan.proceed).toBe(false);
  });

  it("proceeds only when project + confirm match and the export gate is set", () => {
    const plan = resolveWipePlan(
      parseArgs(["--project", PROJECT, "--confirm", PROJECT, "--i-have-exported"]),
      emulator,
    );
    expect(plan.proceed).toBe(true);
  });

  it("leaves every seeded balance intact after all abort paths (no writes)", async () => {
    const db = getAdminFirestore();
    for (const u of [ALICE, BOB]) {
      const doc = (await db.collection("users").doc(u.uid).get()).data();
      expect(doc!.balanceCents).toBe(u.balanceCents);
    }
  });
});

describe("wipe-balances effect", () => {
  it("zeroes balances, preserves points and the ledger", async () => {
    const db = getAdminFirestore();
    const result = await wipeBalances(db);

    expect(result.usersScanned).toBe(3);
    expect(result.balancesZeroed).toBe(2);
    expect(result.totalCentsCleared).toBe(ALICE.balanceCents + BOB.balanceCents);

    for (const u of [ALICE, BOB, CARE]) {
      const doc = (await db.collection("users").doc(u.uid).get()).data();
      expect(doc!.balanceCents).toBe(0);
      expect(doc!.points).toBe(u.points);
    }

    const ledger = (await db.collection("ledger").doc(LEDGER_ID).get()).data();
    expect(ledger!.amountCents).toBe(5000);
    expect(ledger!.balanceAfterCents).toBe(5000);
  });

  it("is idempotent: a second run zeroes nothing", async () => {
    const db = getAdminFirestore();
    const again = await wipeBalances(db);
    expect(again.balancesZeroed).toBe(0);
    expect(again.totalCentsCleared).toBe(0);
  });

  it("rechecks transactionally when a balance appears after an empty scan", async () => {
    const db = getAdminFirestore();
    const creditedRef = db.collection("users").doc(CARE.uid);
    const originalRunTransaction = db.runTransaction.bind(db);
    let injected = false;
    const transactionSpy = vi.spyOn(db, "runTransaction").mockImplementation((updateFunction) => {
      return originalRunTransaction(async (transaction) => {
        if (!injected) {
          injected = true;
          await creditedRef.update({ balanceCents: 500 });
        }
        return updateFunction(transaction);
      });
    });

    try {
      await wipeBalances(db);
      expect(injected).toBe(true);
      expect((await creditedRef.get()).data()!.balanceCents).toBe(0);
    } finally {
      transactionSpy.mockRestore();
    }
  });

  it("revisits an initially zero user credited after the first batch", async () => {
    const db = getAdminFirestore();
    await seedMultiBatchUsers();
    const creditedRef = db.collection("users").doc(LATE_CREDIT_UID);
    const originalBatch = db.batch.bind(db);
    let commitCount = 0;
    const batchSpy = vi.spyOn(db, "batch").mockImplementation(() => {
      const batch = originalBatch();
      const originalCommit = batch.commit.bind(batch);
      vi.spyOn(batch, "commit").mockImplementation(async () => {
        const result = await originalCommit();
        commitCount += 1;
        if (commitCount === 1) await creditedRef.update({ balanceCents: 500 });
        return result;
      });
      return batch as WriteBatch;
    });

    try {
      await wipeBalances(db);
      expect((await creditedRef.get()).data()!.balanceCents).toBe(0);
    } finally {
      batchSpy.mockRestore();
    }
  }, 60_000);

  it("retries a later batch whose precondition becomes stale", async () => {
    const db = getAdminFirestore();
    const seedBatch = db.batch();
    for (const user of MULTI_BATCH_USERS) {
      seedBatch.set(db.collection("users").doc(user.uid), { balanceCents: 50 }, { merge: true });
    }
    const staleRef = db.collection("users").doc(STALE_BATCH_UID);
    seedBatch.set(staleRef, { balanceCents: 50 }, { merge: true });
    await seedBatch.commit();

    const originalBatch = db.batch.bind(db);
    let commitCount = 0;
    let interfered = false;
    const batchSpy = vi.spyOn(db, "batch").mockImplementation(() => {
      const batch = originalBatch();
      const originalCommit = batch.commit.bind(batch);
      vi.spyOn(batch, "commit").mockImplementation(async () => {
        commitCount += 1;
        if (commitCount === 2 && !interfered) {
          interfered = true;
          await staleRef.update({ balanceCents: FieldValue.increment(500) });
        }
        return originalCommit();
      });
      return batch as WriteBatch;
    });

    try {
      await wipeBalances(db);
      expect(interfered).toBe(true);
      expect((await staleRef.get()).data()!.balanceCents).toBe(0);
      const remaining = await db.collection("users").where("balanceCents", "!=", 0).get();
      expect(remaining.empty).toBe(true);
    } finally {
      batchSpy.mockRestore();
    }
  }, 60_000);
});
