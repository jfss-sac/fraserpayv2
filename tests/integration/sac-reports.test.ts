import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as boothSummaryRoute } from "../../src/app/api/sac/booths/[id]/summary/route";
import { GET as reportsRoute } from "../../src/app/api/sac/reports/route";
import {
  type BoothDoc,
  type LedgerEntryDoc,
  boothsCol,
  ledgerCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS, TIMEZONE } from "../../src/lib/shared/constants";
import { getAdminKpis } from "../../src/lib/server/sac-reports";
import type { BoothItem, BoothSummary, ReportsDTO } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const MEMBER = { uid: "reports-member", name: "Ava Member" };
const EXEC = { uid: "reports-exec", name: "Xander Exec" };
const STUDENT = { uid: "reports-student", name: "Stu Dent" };
const WALLET_A = { uid: "reports-wallet-a", name: "Wanda A", balanceCents: 700 };
const WALLET_B = { uid: "reports-wallet-b", name: "Walt B", balanceCents: 300 };

const RING = "reports-ring";
const BAKE = "reports-bake";
const PENDING = "reports-pending";

const RING_ITEMS: BoothItem[] = [
  { id: "play", name: "Play", priceCents: 200, isCustom: false },
  { id: "prize", name: "Prize", priceCents: 500, isCustom: false },
];
const BAKE_ITEMS: BoothItem[] = [{ id: "cake", name: "Cake", priceCents: 300, isCustom: false }];

const cookies: Record<string, string> = {};

function todayToronto(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

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

async function makeUser(
  uid: string,
  displayName: string,
  roles: { sacMember: boolean; sacExec: boolean },
  balanceCents = 0,
): Promise<void> {
  await usersCol()
    .doc(uid)
    .set({
      email: `${uid}@pdsb.net`,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      studentNumber: null,
      paymentCode: `fp1-${uid}`,
      balanceCents,
      points: 0,
      roles,
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

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
      joinCode: status === "pending" ? null : "BOOT-7Q3R4",
      submitterUid: EXEC.uid,
      submitterEmail: `${EXEC.uid}@pdsb.net`,
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
    studentUid: "some-student",
    studentNumber: "700001",
    studentName: "Seed Student",
    actorUid: MEMBER.uid,
    actorName: MEMBER.name,
    tags: [],
    idempotencyKey: `reports-seed-${seq}`,
    createdAt: Timestamp.fromMillis(Date.parse("2024-01-15T15:00:00Z") + seq * 1000),
    createdDate: "2024-01-15",
    ...overrides,
  };
  const ref = ledgerCol().doc();
  await ref.set(entry);
  return ref.id;
}

function reportsReq(actor: string | null): Request {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/sac/reports`, { method: "GET", headers });
}

function boothSummaryReq(actor: string, boothId: string): Request {
  return new Request(`${ORIGIN}/api/sac/booths/${boothId}/summary`, {
    method: "GET",
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}` },
  });
}

async function getBody(actor: string): Promise<ReportsDTO> {
  return (await (await reportsRoute(reportsReq(actor))).json()) as ReportsDTO;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser(MEMBER.uid, MEMBER.name, { sacMember: true, sacExec: false });
  await makeUser(EXEC.uid, EXEC.name, { sacMember: true, sacExec: true });
  await makeUser(STUDENT.uid, STUDENT.name, { sacMember: false, sacExec: false });
  await makeUser(
    WALLET_A.uid,
    WALLET_A.name,
    { sacMember: false, sacExec: false },
    WALLET_A.balanceCents,
  );
  await makeUser(
    WALLET_B.uid,
    WALLET_B.name,
    { sacMember: false, sacExec: false },
    WALLET_B.balanceCents,
  );

  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[STUDENT.uid] = await mintSessionCookie(STUDENT.uid);

  await makeBooth(RING, "approved", RING_ITEMS);
  await makeBooth(BAKE, "deactivated", BAKE_ITEMS);
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

  await seedEntry({ type: "topup", direction: "credit", method: "cash", amountCents: 500 });
  await seedEntry({ type: "topup", direction: "credit", method: "cash", amountCents: 1000 });
  await seedEntry({ type: "topup", direction: "credit", method: "card", amountCents: 2000 });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))),
  );
  await db.recursiveDelete(db.collection("booths"));
  vi.restoreAllMocks();
});

describe("GET /api/sac/reports — access & shape", () => {
  it("lets a SAC member read with no-store", async () => {
    const res = await reportsRoute(reportsReq(MEMBER.uid));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("lets an exec read", async () => {
    expect((await reportsRoute(reportsReq(EXEC.uid))).status).toBe(200);
  });

  it("forbids a non-SAC student", async () => {
    const res = await reportsRoute(reportsReq(STUDENT.uid));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request", async () => {
    expect((await reportsRoute(reportsReq(null))).status).toBe(401);
  });
});

describe("GET /api/sac/reports — booth gross (A6)", () => {
  it("computes per-booth gross as purchases minus refunds, ordered by gross", async () => {
    const body = await getBody(MEMBER.uid);
    expect(body.booths.map((b) => b.boothId)).toEqual([RING, BAKE]);

    const ring = body.booths.find((b) => b.boothId === RING)!;
    expect(ring.grossCents).toBe(1300);
    expect(ring.purchaseCount).toBe(2);
    expect(ring.refundCount).toBe(1);

    const bake = body.booths.find((b) => b.boothId === BAKE)!;
    expect(bake.status).toBe("deactivated");
    expect(bake.grossCents).toBe(600);

    expect(body.grossTotalCents).toBe(1900);
  });

  it("excludes pending booths that have no payout basis", async () => {
    const body = await getBody(MEMBER.uid);
    expect(body.booths.some((b) => b.boothId === PENDING)).toBe(false);
  });

  it("ships no per-item breakdown, so the payload never scales with the ledger", async () => {
    const body = await getBody(MEMBER.uid);
    for (const booth of body.booths) {
      expect(booth).not.toHaveProperty("items");
    }
  });
});

describe("GET /api/sac/booths/[id]/summary — drill-down breakdown", () => {
  it("returns the item breakdown for a SAC member", async () => {
    const res = await boothSummaryRoute(boothSummaryReq(MEMBER.uid, RING), {
      params: Promise.resolve({ id: RING }),
    });
    expect(res.status).toBe(200);

    const summary = (await res.json()) as BoothSummary;
    expect(summary.items).toEqual([
      { itemId: "play", name: "Play", qty: 4, revenueCents: 800 },
      { itemId: "prize", name: "Prize", qty: 1, revenueCents: 500 },
    ]);
  });

  it("reconciles per-item revenue with the booth gross reported by the aggregation (A6)", async () => {
    const body = await getBody(MEMBER.uid);

    for (const booth of body.booths) {
      const res = await boothSummaryRoute(boothSummaryReq(MEMBER.uid, booth.boothId), {
        params: Promise.resolve({ id: booth.boothId }),
      });
      const summary = (await res.json()) as BoothSummary;
      const itemTotal = summary.items.reduce((sum, i) => sum + i.revenueCents, 0);

      expect(itemTotal).toBe(booth.grossCents);
      expect(summary.grossCents).toBe(booth.grossCents);
    }
  });

  it("forbids a non-SAC student", async () => {
    const res = await boothSummaryRoute(boothSummaryReq(STUDENT.uid, RING), {
      params: Promise.resolve({ id: RING }),
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("404s an unknown booth", async () => {
    const res = await boothSummaryRoute(boothSummaryReq(MEMBER.uid, "no-such-booth"), {
      params: Promise.resolve({ id: "no-such-booth" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sac/reports — top-ups & liability", () => {
  it("splits top-ups by method", async () => {
    const body = await getBody(MEMBER.uid);
    expect(body.topups).toEqual({
      cashCents: 1500,
      cardCents: 2000,
      totalCents: 3500,
      count: 3,
    });
  });

  it("reports outstanding liability as the sum of all user balances", async () => {
    const body = await getBody(MEMBER.uid);

    const snap = await usersCol().get();
    const expected = snap.docs.reduce((sum, d) => sum + d.data().balanceCents, 0);
    expect(body.outstandingLiabilityCents).toBe(expected);
    expect(body.outstandingLiabilityCents).toBe(WALLET_A.balanceCents + WALLET_B.balanceCents);
  });
});

describe("admin landing KPIs", () => {
  it("matches independent ledger, booth, and account recomputations", async () => {
    const today = todayToronto();
    await seedEntry({
      type: "topup",
      direction: "credit",
      amountCents: 500,
      createdAt: Timestamp.now(),
      createdDate: today,
    });
    await seedEntry({
      type: "purchase",
      direction: "debit",
      amountCents: 1800,
      createdAt: Timestamp.now(),
      createdDate: today,
    });
    await seedEntry({
      type: "refund",
      direction: "credit",
      amountCents: 300,
      createdAt: Timestamp.now(),
      createdDate: today,
    });

    const [kpis, ledgerSnap, boothSnap, userSnap] = await Promise.all([
      getAdminKpis(today),
      ledgerCol().get(),
      boothsCol().get(),
      usersCol().get(),
    ]);
    const ledger = ledgerSnap.docs.map((doc) => doc.data());
    const todayTransactions = ledger.filter((entry) => entry.createdDate === today);
    const grossRevenueCents = ledger.reduce(
      (total, entry) =>
        total +
        (entry.type === "purchase"
          ? entry.amountCents
          : entry.type === "refund"
            ? -entry.amountCents
            : 0),
      0,
    );

    expect(kpis).toEqual({
      transactionsToday: todayTransactions.length,
      activeBooths: boothSnap.docs.filter((doc) => doc.data().status === "approved").length,
      accounts: userSnap.size,
      grossRevenueCents,
    });
  });
});
