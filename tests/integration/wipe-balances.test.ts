import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { parseArgs, resolveWipePlan, wipeBalances } from "../../scripts/wipe-balances";

const PROJECT = "demo-fraserpay";

const ALICE = { uid: "wipe-alice", balanceCents: 5000, points: 120 };
const BOB = { uid: "wipe-bob", balanceCents: 250, points: 3 };
const CARE = { uid: "wipe-zero", balanceCents: 0, points: 40 };
const LEDGER_ID = "wipe-ledger-1";

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

  it("refuses to overwrite a balance changed after the wipe snapshot", async () => {
    const db = getAdminFirestore();
    const userRef = db.collection("users").doc(ALICE.uid);
    await userRef.update({ balanceCents: ALICE.balanceCents });

    const commitStarted = Promise.withResolvers<void>();
    const releaseCommit = Promise.withResolvers<void>();
    const originalBatch = db.batch.bind(db);
    const batchSpy = vi.spyOn(db, "batch").mockImplementation(() => {
      const batch = originalBatch();
      const originalCommit = batch.commit.bind(batch);
      vi.spyOn(batch, "commit").mockImplementation(async () => {
        commitStarted.resolve();
        await releaseCommit.promise;
        return originalCommit();
      });
      return batch as WriteBatch;
    });

    const wipe = wipeBalances(db);
    await commitStarted.promise;
    await userRef.update({ balanceCents: ALICE.balanceCents + 500 });
    releaseCommit.resolve();

    await expect(wipe).rejects.toMatchObject({ code: 9 });
    expect((await userRef.get()).data()!.balanceCents).toBe(ALICE.balanceCents + 500);
    batchSpy.mockRestore();
  });
});
