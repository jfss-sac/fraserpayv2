import { type DocumentReference, Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as lookupRoute } from "../../src/app/api/booth/lookup/route";
import { RECENT_PURCHASE_WINDOW_MS } from "../../src/lib/server/booth-lookup";
import {
  type LedgerEntryDoc,
  boothsCol,
  ledgerCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { RATE_LIMITS } from "../../src/lib/server/ratelimit";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem, LedgerType, LookupResult } from "../../src/lib/shared/types";

const RATE_LIMIT_SWEEP_TIMEOUT_MS = 60_000;

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/booth/lookup";

const OPERATOR = { uid: "lookup-operator", name: "Opal Operator" };
const OUTSIDER = { uid: "lookup-outsider", name: "Otto Outsider" };
const RL_OPERATOR = { uid: "lookup-rl-operator", name: "Rex Ratelimit" };

const BOOTH_ID = "lookup-booth";

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
];

const cookies: Record<string, string> = {};

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

async function makeUser(args: {
  uid: string;
  displayName: string;
  studentNumber?: string | null;
  paymentCode: string;
  balanceCents?: number;
  suspended?: boolean;
}): Promise<void> {
  await usersCol()
    .doc(args.uid)
    .set({
      email: `${args.uid}@pdsb.net`,
      displayName: args.displayName,
      displayNameLower: args.displayName.toLowerCase(),
      studentNumber: args.studentNumber ?? null,
      paymentCode: args.paymentCode,
      balanceCents: args.balanceCents ?? 0,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: args.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function makeBooth(id: string): Promise<void> {
  await boothsCol()
    .doc(id)
    .set({
      name: `Booth ${id}`,
      nameLower: `booth ${id}`,
      description: "test booth",
      status: "approved",
      items: ITEMS,
      joinCode: "BOOT-3F7K2",
      submitterUid: OPERATOR.uid,
      submitterEmail: `${OPERATOR.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
}

function post(actor: string, body: unknown): Request {
  return new Request(`${ORIGIN}${ENDPOINT}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}`,
    },
    body: JSON.stringify(body),
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const seededLedger: DocumentReference<LedgerEntryDoc>[] = [];

let ledgerSeq = 0;
async function seedLedgerEntry(args: {
  studentUid: string;
  studentName: string;
  type: LedgerType;
  amountCents: number;
  ageMs: number;
  boothId?: string;
  originalEntryId?: string;
}): Promise<string> {
  ledgerSeq += 1;
  const ref = ledgerCol().doc();
  await ref.set({
    type: args.type,
    amountCents: args.amountCents,
    direction: args.type === "purchase" ? "debit" : "credit",
    balanceAfterCents: 0,
    studentUid: args.studentUid,
    studentNumber: null,
    studentName: args.studentName,
    actorUid: OPERATOR.uid,
    actorName: OPERATOR.name,
    tags: [],
    idempotencyKey: `lookup-seed-${ledgerSeq}`,
    createdAt: Timestamp.fromMillis(Date.now() - args.ageMs),
    createdDate: "2026-08-08",
    ...(args.boothId !== undefined
      ? { boothId: args.boothId, boothName: `Booth ${args.boothId}` }
      : {}),
    ...(args.originalEntryId !== undefined ? { originalEntryId: args.originalEntryId } : {}),
  });
  seededLedger.push(ref);
  return ref.id;
}

let buyerSeq = 0;
async function freshBuyer(
  balanceCents: number,
  overrides: { suspended?: boolean } = {},
): Promise<{ uid: string; studentNumber: string; paymentCode: string; displayName: string }> {
  buyerSeq += 1;
  const uid = `lookup-buyer-${buyerSeq}`;
  const studentNumber = `9300${buyerSeq.toString().padStart(2, "0")}`;
  const paymentCode = `fp1-LKP${buyerSeq.toString().padStart(3, "0")}`;
  const displayName = `Buyer ${buyerSeq}`;
  await makeUser({ uid, displayName, studentNumber, paymentCode, balanceCents, ...overrides });
  return { uid, studentNumber, paymentCode, displayName };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({ uid: OPERATOR.uid, displayName: OPERATOR.name, paymentCode: "fp1-OPERAT" });
  await makeUser({ uid: OUTSIDER.uid, displayName: OUTSIDER.name, paymentCode: "fp1-OUTSID" });
  await makeUser({
    uid: RL_OPERATOR.uid,
    displayName: RL_OPERATOR.name,
    paymentCode: "fp1-RATELM",
  });
  cookies[OPERATOR.uid] = await mintSessionCookie(OPERATOR.uid);
  cookies[OUTSIDER.uid] = await mintSessionCookie(OUTSIDER.uid);
  cookies[RL_OPERATOR.uid] = await mintSessionCookie(RL_OPERATOR.uid);

  await makeBooth(BOOTH_ID);
  for (const uid of [OPERATOR.uid, RL_OPERATOR.uid]) {
    await membersCol(BOOTH_ID).doc(uid).set({ uid, displayName: uid, joinedAt: Timestamp.now() });
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(seededLedger.map((ref) => ref.delete()));
  await Promise.all(["users", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))));
  await db.recursiveDelete(db.collection("booths"));
  vi.restoreAllMocks();
});

describe("POST /api/booth/lookup", () => {
  it("returns exactly name + balanceCents + lastPurchase — no other field leaks (I10)", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as LookupResult;
    expect(body).toEqual({ name: buyer.displayName, balanceCents: 2000, lastPurchase: null });
    expect(Object.keys(body).sort()).toEqual(["balanceCents", "lastPurchase", "name"]);
    expect(text).not.toContain("studentNumber");
    expect(text).not.toContain("paymentCode");
    expect(text).not.toContain("points");
    expect(text).not.toContain("email");
    expect(text).not.toContain("suspended");
  });

  it("looks a buyer up by payment code", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as LookupResult).toEqual({
      name: buyer.displayName,
      balanceCents: 2000,
      lastPurchase: null,
    });
  });

  it("reports a zero balance rather than omitting it", async () => {
    const buyer = await freshBuyer(0);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect((await res.json()) as LookupResult).toEqual({
      name: buyer.displayName,
      balanceCents: 0,
      lastPurchase: null,
    });
  });

  it("refuses a student-number buyer — the balance is not walkable (NFR-9, I10)", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { studentNumber: buyer.studentNumber },
      }),
    );
    const text = await res.text();
    expect(res.status).toBe(400);
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe("VALIDATION");
    expect(text).not.toContain(buyer.displayName);
  });

  it("refuses a student number that matches nobody with the same VALIDATION", async () => {
    const res = await lookupRoute(
      post(OPERATOR.uid, { boothId: BOOTH_ID, buyer: { studentNumber: "999999999" } }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("returns a generic NOT_FOUND for an unknown buyer", async () => {
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: "fp1-NOSUCHBUYER" },
      }),
    );
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("rejects a suspended buyer with SUSPENDED", async () => {
    const buyer = await freshBuyer(2000, { suspended: true });
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("SUSPENDED");
  });

  it("forbids an operator who is not a member of the booth", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post(OUTSIDER.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("rejects unknown fields in the body (strict scope)", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        wantPoints: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("keeps request and response bodies each under 2 KB (NFR-3)", async () => {
    const buyer = await freshBuyer(2000);
    const requestBody = {
      boothId: BOOTH_ID,
      buyer: { paymentCode: buyer.paymentCode },
    };
    const requestBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
    const res = await lookupRoute(post(OPERATOR.uid, requestBody));
    const text = await res.text();
    const responseBytes = Buffer.byteLength(text, "utf8");
    console.info(
      `[nfr-3] lookup request ${requestBytes} B, response ${responseBytes} B (limit 2048)`,
    );
    expect(requestBytes).toBeLessThan(2048);
    expect(responseBytes).toBeLessThan(2048);
  });

  it("surfaces a purchase this booth already rang for the buyer", async () => {
    const buyer = await freshBuyer(2000);
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: 8_000,
      boothId: BOOTH_ID,
    });

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    const body = (await res.json()) as LookupResult;
    expect(body.lastPurchase?.amountCents).toBe(450);
    expect(body.lastPurchase?.ageMs).toBeGreaterThanOrEqual(8_000);
    expect(body.lastPurchase?.ageMs).toBeLessThan(60_000);
  });

  it("reports the sale's age from the server clock, not an absolute timestamp", async () => {
    const buyer = await freshBuyer(2000);
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: 4 * 60_000,
      boothId: BOOTH_ID,
    });

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    const lastPurchase = ((await res.json()) as LookupResult).lastPurchase;
    expect(Object.keys(lastPurchase ?? {}).sort()).toEqual(["ageMs", "amountCents"]);
    expect(lastPurchase!.ageMs).toBeGreaterThanOrEqual(4 * 60_000);
    expect(lastPurchase!.ageMs).toBeLessThan(5 * 60_000);
  });

  it("never reveals the buyer's purchases at other booths (I10)", async () => {
    const buyer = await freshBuyer(2000);
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: 8_000,
      boothId: "some-other-booth",
    });

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(((await res.json()) as LookupResult).lastPurchase).toBeNull();
  });

  it("ignores a purchase older than the duplicate-sale window", async () => {
    const buyer = await freshBuyer(2000);
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: RECENT_PURCHASE_WINDOW_MS + 60_000,
      boothId: BOOTH_ID,
    });

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(((await res.json()) as LookupResult).lastPurchase).toBeNull();
  });

  it("counts only purchases — a refund at this booth is not a last purchase", async () => {
    const buyer = await freshBuyer(2000);
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "refund",
      amountCents: 450,
      ageMs: 5_000,
      boothId: BOOTH_ID,
    });

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(((await res.json()) as LookupResult).lastPurchase).toBeNull();
  });

  it("stops warning about a purchase that was already refunded", async () => {
    const buyer = await freshBuyer(2000);
    const purchaseId = await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: 120_000,
      boothId: BOOTH_ID,
    });
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "refund",
      amountCents: 450,
      ageMs: 60_000,
      boothId: BOOTH_ID,
      originalEntryId: purchaseId,
    });

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(((await res.json()) as LookupResult).lastPurchase).toBeNull();
  });

  it("keeps warning when only part of the purchase was refunded", async () => {
    const buyer = await freshBuyer(2000);
    const purchaseId = await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: 120_000,
      boothId: BOOTH_ID,
    });
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "refund",
      amountCents: 200,
      ageMs: 60_000,
      boothId: BOOTH_ID,
      originalEntryId: purchaseId,
    });

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(((await res.json()) as LookupResult).lastPurchase?.amountCents).toBe(450);
  });

  it("still finds this booth's sale behind 20 newer purchases elsewhere", async () => {
    const buyer = await freshBuyer(2000);
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: 120_000,
      boothId: BOOTH_ID,
    });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        seedLedgerEntry({
          studentUid: buyer.uid,
          studentName: buyer.displayName,
          type: "purchase",
          amountCents: 100,
          ageMs: 60_000 - i * 1000,
          boothId: `elsewhere-${i}`,
        }),
      ),
    );

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(((await res.json()) as LookupResult).lastPurchase?.amountCents).toBe(450);
  });

  it("still finds this booth's sale behind 30 newer purchases elsewhere (beyond the scan limit)", async () => {
    const buyer = await freshBuyer(2000);
    await seedLedgerEntry({
      studentUid: buyer.uid,
      studentName: buyer.displayName,
      type: "purchase",
      amountCents: 450,
      ageMs: 120_000,
      boothId: BOOTH_ID,
    });
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        seedLedgerEntry({
          studentUid: buyer.uid,
          studentName: buyer.displayName,
          type: "purchase",
          amountCents: 100,
          ageMs: 90_000 - i * 1000,
          boothId: `elsewhere-${i}`,
        }),
      ),
    );

    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(((await res.json()) as LookupResult).lastPurchase?.amountCents).toBe(450);
  });

  it(
    "rate-limits an operator past the per-minute lookup cap",
    async () => {
      const buyer = await freshBuyer(2000);
      const body = {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      };
      const { limit } = RATE_LIMITS.lookup;
      const codes: number[] = [];
      for (let i = 0; i < limit + 1; i += 1) {
        codes.push((await lookupRoute(post(RL_OPERATOR.uid, body))).status);
      }
      expect(codes.slice(0, limit).every((s) => s === 200)).toBe(true);
      expect(codes[limit]).toBe(429);
    },
    RATE_LIMIT_SWEEP_TIMEOUT_MS,
  );
});
