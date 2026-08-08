import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { pointsFor } from "../../src/lib/shared/money";
import { type SeedSummary, seed } from "../../scripts/seed-dev-data";

const PAYMENT_CODE = /^fp1-[0-9A-HJKMNP-TV-Z]{26}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

let summary: SeedSummary;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Integration test requires the auth + firestore emulators (run via emulators:exec).",
    );
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  summary = await seed();
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all([
    db.recursiveDelete(db.collection("users")),
    db.recursiveDelete(db.collection("booths")),
    db.recursiveDelete(db.collection("ledger")),
  ]);
  await getAdminAuth().deleteUsers(summary.users);
  vi.restoreAllMocks();
});

describe("seed-dev-data against the emulators", () => {
  it("reports the fixtures it created", () => {
    expect(summary.users).toHaveLength(6);
    expect(summary.booths).toEqual([
      "seed-booth-pending",
      "seed-booth-approved",
      "seed-booth-deactivated",
    ]);
    expect(summary.ledgerEntries).toBe(2);
  });

  it("creates an Auth user for every seeded account", async () => {
    const auth = getAdminAuth();
    for (const uid of summary.users) {
      const record = await auth.getUser(uid);
      expect(record.emailVerified).toBe(true);
      expect(record.email).toBeTruthy();
    }
  });

  it("writes a schema-shaped student with a funded balance backed by a topup", async () => {
    const db = getAdminFirestore();
    const user = (await db.collection("users").doc("seed-student-ava").get()).data();
    expect(user).toBeDefined();
    expect(user!.studentNumber).toBe("843901");
    expect(user!.displayNameLower).toBe("ava nguyen");
    expect(user!.balanceCents).toBe(5000);
    expect(user!.points).toBe(pointsFor(5000));
    expect(user!.suspended).toBe(false);
    expect(user!.roles).toEqual({ sacMember: false, sacExec: false });
    expect(user!.paymentCode).toMatch(PAYMENT_CODE);

    const entry = (await db.collection("ledger").doc("seed-topup-seed-student-ava").get()).data();
    expect(entry).toBeDefined();
    expect(entry!.type).toBe("topup");
    expect(entry!.direction).toBe("credit");
    expect(entry!.amountCents).toBe(5000);
    expect(entry!.balanceAfterCents).toBe(user!.balanceCents);
    expect(entry!.pointsDelta).toBe(user!.points);
    expect(entry!.method).toBe("cash");
    expect(entry!.tags).toContain("high-amount");
    expect(entry!.createdDate).toMatch(YMD);
  });

  it("models the teacher-pattern and SAC accounts", async () => {
    const db = getAdminFirestore();
    const teacher = (await db.collection("users").doc("seed-teacher-murray").get()).data();
    expect(teacher!.studentNumber).toBeNull();

    const chloe = (await db.collection("users").doc("seed-student-chloe").get()).data();
    expect(chloe!.balanceCents).toBe(0);
    expect(chloe!.points).toBe(0);

    const member = (await db.collection("users").doc("seed-sac-member").get()).data();
    expect(member!.roles).toEqual({ sacMember: true, sacExec: false });

    const exec = (await db.collection("users").doc("seed-sac-exec").get()).data();
    expect(exec!.roles).toEqual({ sacMember: true, sacExec: true });
  });

  it("creates one booth in each lifecycle status with a price-locked custom item", async () => {
    const db = getAdminFirestore();

    const pending = (await db.collection("booths").doc("seed-booth-pending").get()).data();
    expect(pending!.status).toBe("pending");
    expect(pending!.joinCode).toBeNull();
    expect(pending!.approvedAt).toBeUndefined();
    expect(pending!.items[0]).toEqual({
      id: "custom",
      name: "Custom",
      priceCents: 50,
      isCustom: true,
    });

    const approved = (await db.collection("booths").doc("seed-booth-approved").get()).data();
    expect(approved!.status).toBe("approved");
    expect(approved!.joinCode).toBe("PIZZ-9K4M7");
    expect(approved!.approvedByUid).toBe("seed-sac-exec");
    expect(approved!.approvedAt).toBeDefined();

    const deactivated = (await db.collection("booths").doc("seed-booth-deactivated").get()).data();
    expect(deactivated!.status).toBe("deactivated");

    const member = (
      await db
        .collection("booths")
        .doc("seed-booth-approved")
        .collection("members")
        .doc("seed-student-ava")
        .get()
    ).data();
    expect(member!.uid).toBe("seed-student-ava");
  });

  it("refuses to run when the Firestore emulator host is unset", async () => {
    const saved = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    try {
      await expect(seed()).rejects.toThrow(/FIRESTORE_EMULATOR_HOST/);
    } finally {
      process.env.FIRESTORE_EMULATOR_HOST = saved;
    }
  });
});
