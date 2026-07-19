import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as walletRoute } from "../../src/app/api/wallet/route";
import { type LedgerEntryDoc, ledgerCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { WalletDTO, WalletHistoryEntry } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/wallet";

const HISTORY_KEYS = new Set<keyof WalletHistoryEntry>([
  "id",
  "type",
  "direction",
  "amountCents",
  "balanceAfterCents",
  "createdAt",
  "tags",
  "boothName",
  "method",
  "lineItems",
  "reason",
]);

async function mintSessionCookie(uid: string): Promise<string> {
  const customToken = await getAdminAuth().createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error(`emulator did not return an idToken: ${JSON.stringify(body)}`);
  return getAdminAuth().createSessionCookie(body.idToken, { expiresIn: SESSION_TTL_MS });
}

let studentSeq = 0;
async function freshStudent(
  args: {
    balanceCents?: number;
    points?: number;
    suspended?: boolean;
  } = {},
): Promise<{ uid: string; cookie: string }> {
  studentSeq += 1;
  const uid = `wallet-student-${studentSeq}`;
  await usersCol()
    .doc(uid)
    .set({
      email: `${uid}@pdsb.net`,
      displayName: `Student ${studentSeq}`,
      displayNameLower: `student ${studentSeq}`,
      studentNumber: `7000${studentSeq.toString().padStart(2, "0")}`,
      paymentCode: `fp1-WLT${studentSeq.toString().padStart(3, "0")}`,
      balanceCents: args.balanceCents ?? 0,
      points: args.points ?? 0,
      roles: { sacMember: false, sacExec: false },
      suspended: args.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  return { uid, cookie: await mintSessionCookie(uid) };
}

let entrySeq = 0;
const BASE_MS = 1_700_000_000_000;

async function seedEntry(
  uid: string,
  overrides: Partial<LedgerEntryDoc> & { atMs?: number } = {},
): Promise<string> {
  entrySeq += 1;
  const { atMs, ...rest } = overrides;
  const entry: LedgerEntryDoc = {
    type: "purchase",
    amountCents: 100,
    direction: "debit",
    balanceAfterCents: 0,
    studentUid: uid,
    studentNumber: "700001",
    studentName: "Seeded Student",
    actorUid: "seed-actor",
    actorName: "Seed Actor",
    tags: [],
    idempotencyKey: `seed-key-${entrySeq}`,
    createdAt: Timestamp.fromMillis(atMs ?? BASE_MS + entrySeq * 1000),
    createdDate: "2023-11-14",
    ...rest,
  };
  const ref = ledgerCol().doc();
  await ref.set(entry);
  return ref.id;
}

function get(cookie: string | null): Request {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.cookie = `${SESSION_COOKIE_NAME}=${cookie}`;
  return new Request(`${ORIGIN}${ENDPOINT}`, { method: "GET", headers });
}

async function walletOf(cookie: string): Promise<{ res: Response; body: WalletDTO }> {
  const res = await walletRoute(get(cookie));
  return { res, body: (await res.json()) as WalletDTO };
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))),
  );
  vi.restoreAllMocks();
});

describe("GET /api/wallet", () => {
  it("returns balance, points, asOf and no-store for an authenticated student", async () => {
    const student = await freshStudent({ balanceCents: 1275, points: 40 });
    const { res, body } = await walletOf(student.cookie);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.balanceCents).toBe(1275);
    expect(body.points).toBe(40);
    expect(Number.isNaN(Date.parse(body.asOf))).toBe(false);
    expect(Date.now() - Date.parse(body.asOf)).toBeLessThan(60_000);
    expect(body.history).toEqual([]);
  });

  it("fully itemizes a purchase entry (FR-10c)", async () => {
    const student = await freshStudent({ balanceCents: 1350 });
    const id = await seedEntry(student.uid, {
      type: "purchase",
      direction: "debit",
      amountCents: 650,
      balanceAfterCents: 1350,
      tags: ["high-amount"],
      boothName: "Taco Booth",
      lineItems: [
        { itemId: "coffee", name: "Coffee", qty: 2, unitPriceCents: 250 },
        { itemId: "custom", name: "Custom", qty: 3, unitPriceCents: 50 },
      ],
    });

    const { body } = await walletOf(student.cookie);
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toEqual({
      id,
      type: "purchase",
      direction: "debit",
      amountCents: 650,
      balanceAfterCents: 1350,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      tags: ["high-amount"],
      boothName: "Taco Booth",
      lineItems: [
        { itemId: "coffee", name: "Coffee", qty: 2, unitPriceCents: 250 },
        { itemId: "custom", name: "Custom", qty: 3, unitPriceCents: 50 },
      ],
    });
  });

  it("maps each ledger type with only its relevant fields (complete and minimal)", async () => {
    const student = await freshStudent();
    await seedEntry(student.uid, {
      type: "topup",
      direction: "credit",
      amountCents: 2000,
      method: "cash",
      pointsDelta: 100,
      atMs: BASE_MS + 10_000,
    });
    await seedEntry(student.uid, {
      type: "purchase",
      direction: "debit",
      amountCents: 250,
      boothName: "Taco Booth",
      boothId: "taco",
      lineItems: [{ itemId: "coffee", name: "Coffee", qty: 1, unitPriceCents: 250 }],
      atMs: BASE_MS + 20_000,
    });
    await seedEntry(student.uid, {
      type: "refund",
      direction: "credit",
      amountCents: 250,
      boothName: "Taco Booth",
      boothId: "taco",
      reason: "Wrong order",
      originalEntryId: "orig-1",
      lineItems: [{ itemId: "coffee", name: "Coffee", qty: 1, unitPriceCents: 250 }],
      atMs: BASE_MS + 30_000,
    });
    await seedEntry(student.uid, {
      type: "adjustment",
      direction: "credit",
      amountCents: 500,
      reason: "Goodwill",
      atMs: BASE_MS + 40_000,
    });

    const { body } = await walletOf(student.cookie);
    const byType = Object.fromEntries(body.history.map((e) => [e.type, e]));

    for (const entry of body.history) {
      for (const key of Object.keys(entry)) {
        expect(HISTORY_KEYS.has(key as keyof WalletHistoryEntry)).toBe(true);
      }
    }

    expect(byType.topup!.method).toBe("cash");
    expect(byType.topup!.lineItems).toBeUndefined();
    expect(byType.topup!.reason).toBeUndefined();
    expect(byType.topup).not.toHaveProperty("pointsDelta");

    expect(byType.purchase!.lineItems).toHaveLength(1);
    expect(byType.purchase!.boothName).toBe("Taco Booth");
    expect(byType.purchase!.method).toBeUndefined();
    expect(byType.purchase).not.toHaveProperty("boothId");

    expect(byType.refund!.reason).toBe("Wrong order");
    expect(byType.refund!.lineItems).toHaveLength(1);
    expect(byType.refund).not.toHaveProperty("originalEntryId");

    expect(byType.adjustment!.reason).toBe("Goodwill");
    expect(byType.adjustment!.lineItems).toBeUndefined();
    expect(byType.adjustment!.boothName).toBeUndefined();
  });

  it("returns only the caller's own entries", async () => {
    const student = await freshStudent();
    const other = await freshStudent();
    const mine = await seedEntry(student.uid, { atMs: BASE_MS + 5_000 });
    const theirs = await seedEntry(other.uid, { atMs: BASE_MS + 6_000 });

    const { body } = await walletOf(student.cookie);
    const ids = body.history.map((e) => e.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(body.history.every((e) => e.balanceAfterCents !== undefined)).toBe(true);
  });

  it("orders history newest-first", async () => {
    const student = await freshStudent();
    const oldest = await seedEntry(student.uid, { atMs: BASE_MS + 100_000 });
    const middle = await seedEntry(student.uid, { atMs: BASE_MS + 200_000 });
    const newest = await seedEntry(student.uid, { atMs: BASE_MS + 300_000 });

    const { body } = await walletOf(student.cookie);
    expect(body.history.map((e) => e.id)).toEqual([newest, middle, oldest]);
  });

  it("caps history at 20 and returns the most recent", async () => {
    const student = await freshStudent();
    const ids: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      ids.push(await seedEntry(student.uid, { atMs: BASE_MS + 400_000 + i * 1000 }));
    }
    const newestFirst = [...ids].reverse();

    const { body } = await walletOf(student.cookie);
    expect(body.history).toHaveLength(20);
    expect(body.history.map((e) => e.id)).toEqual(newestFirst.slice(0, 20));
  });

  it("rejects an unauthenticated request", async () => {
    const res = await walletRoute(get(null));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("still returns the wallet for a suspended student (A3)", async () => {
    const student = await freshStudent({ balanceCents: 300, suspended: true });
    await seedEntry(student.uid, { atMs: BASE_MS + 700_000 });

    const { res, body } = await walletOf(student.cookie);
    expect(res.status).toBe(200);
    expect(body.balanceCents).toBe(300);
    expect(body.history).toHaveLength(1);
  });
});
