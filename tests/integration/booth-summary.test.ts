import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import { GET as summaryRoute } from "../../src/app/api/booth/[id]/summary/route";
import { getBoothSummary } from "../../src/lib/server/dal";
import {
  type LedgerEntryDoc,
  boothsCol,
  ledgerCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { buildIdempotencyContext } from "../../src/lib/server/idempotency";
import { refundPurchase } from "../../src/lib/server/money/refund";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem, BoothSummary, ChargeResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const OPERATOR = { uid: "summary-operator", name: "Opal Operator" };
const OUTSIDER = { uid: "summary-outsider", name: "Otto Outsider" };

const BOOTH_ID = "summary-booth";
const OTHER_BOOTH_ID = "summary-other-booth";

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false },
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
      suspended: false,
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
      items: ITEMS.map((i) => ({ ...i })),
      joinCode: "TEST-001",
      submitterUid: OPERATOR.uid,
      submitterEmail: `${OPERATOR.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
  await membersCol(id)
    .doc(OPERATOR.uid)
    .set({ uid: OPERATOR.uid, displayName: OPERATOR.name, joinedAt: Timestamp.now() });
}

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `f47ac10b-58cc-4372-a567-${keyCounter.toString(16).padStart(12, "0")}`;
}

let buyerSeq = 0;
async function freshBuyer(balanceCents: number): Promise<{ uid: string; studentNumber: string }> {
  buyerSeq += 1;
  const uid = `summary-buyer-${buyerSeq}`;
  const studentNumber = `9300${buyerSeq.toString().padStart(2, "0")}`;
  await makeUser({
    uid,
    displayName: `Buyer ${buyerSeq}`,
    studentNumber,
    paymentCode: `fp1-SBY${buyerSeq.toString().padStart(3, "0")}`,
    balanceCents,
  });
  return { uid, studentNumber };
}

async function charge(
  boothId: string,
  studentNumber: string,
  items: { itemId: string; qty: number }[],
): Promise<ChargeResult> {
  const request = new Request(`${ORIGIN}/api/booth/charge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[OPERATOR.uid]}`,
      "idempotency-key": nextKey(),
    },
    body: JSON.stringify({ boothId, buyer: { studentNumber }, items }),
  });
  const res = await chargeRoute(request);
  if (res.status !== 200) throw new Error(`charge failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ChargeResult;
}

async function refund(
  originalEntryId: string,
  lineItems: { itemId: string; qty: number }[],
): Promise<void> {
  const key = nextKey();
  const body = { originalEntryId, reason: "test refund", lineItems };
  const request = new Request(`${ORIGIN}/api/exec/refund`, {
    method: "POST",
    headers: { "idempotency-key": key },
  });
  const idempotency = buildIdempotencyContext({
    request,
    actorUid: OPERATOR.uid,
    endpoint: "/api/exec/refund",
    body,
  });
  await refundPurchase({
    input: body,
    actor: { uid: OPERATOR.uid, displayName: OPERATOR.name },
    idempotency,
  });
}

function summaryRequest(actor: string | null): Request {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/booth/${BOOTH_ID}/summary`, { method: "GET", headers });
}

function summaryContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function recomputeFromLedger(boothId: string): Promise<{
  grossCents: number;
  items: Map<string, number>;
}> {
  const snap = await ledgerCol().where("boothId", "==", boothId).get();
  let grossCents = 0;
  const items = new Map<string, number>();
  for (const doc of snap.docs) {
    const e = doc.data() as LedgerEntryDoc;
    const sign = e.type === "purchase" ? 1 : e.type === "refund" ? -1 : 0;
    if (sign === 0) continue;
    grossCents += sign * e.amountCents;
    for (const li of e.lineItems ?? []) {
      items.set(li.itemId, (items.get(li.itemId) ?? 0) + sign * li.qty * li.unitPriceCents);
    }
  }
  return { grossCents, items };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({ uid: OPERATOR.uid, displayName: OPERATOR.name, paymentCode: "fp1-SOPERA" });
  await makeUser({ uid: OUTSIDER.uid, displayName: OUTSIDER.name, paymentCode: "fp1-SOUTSI" });
  cookies[OPERATOR.uid] = await mintSessionCookie(OPERATOR.uid);
  cookies[OUTSIDER.uid] = await mintSessionCookie(OUTSIDER.uid);

  await makeBooth(BOOTH_ID);
  await makeBooth(OTHER_BOOTH_ID);

  const buyer1 = await freshBuyer(2000);
  const buyer2 = await freshBuyer(2000);
  const buyer3 = await freshBuyer(2000);

  const purchase1 = await charge(BOOTH_ID, buyer1.studentNumber, [
    { itemId: "coffee", qty: 2 },
    { itemId: "cookie", qty: 1 },
  ]);
  await charge(BOOTH_ID, buyer2.studentNumber, [
    { itemId: "coffee", qty: 1 },
    { itemId: "custom", qty: 3 },
  ]);
  await charge(OTHER_BOOTH_ID, buyer3.studentNumber, [{ itemId: "coffee", qty: 4 }]);

  await refund(purchase1.entryId, [{ itemId: "coffee", qty: 1 }]);
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

describe("GET /api/booth/[id]/summary", () => {
  it("returns own-booth gross and per-item breakdown for a member", async () => {
    const res = await summaryRoute(summaryRequest(OPERATOR.uid), summaryContext(BOOTH_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BoothSummary;

    expect(body.boothId).toBe(BOOTH_ID);
    expect(body.boothName).toBe(`Booth ${BOOTH_ID}`);
    expect(body.grossCents).toBe(800);
    expect(body.purchaseCount).toBe(2);
    expect(body.refundCount).toBe(1);
    expect(body.items).toEqual([
      { itemId: "coffee", name: "Coffee", qty: 2, revenueCents: 500 },
      { itemId: "cookie", name: "Cookie", qty: 1, revenueCents: 150 },
      { itemId: "custom", name: "Custom", qty: 3, revenueCents: 150 },
    ]);
  });

  it("reconciles gross and per-item revenue with an independent ledger recomputation", async () => {
    const summary = (await getBoothSummary(BOOTH_ID))!;
    const recomputed = await recomputeFromLedger(BOOTH_ID);

    expect(summary.grossCents).toBe(recomputed.grossCents);
    expect(summary.items.reduce((sum, i) => sum + i.revenueCents, 0)).toBe(summary.grossCents);
    for (const item of summary.items) {
      expect(item.revenueCents).toBe(recomputed.items.get(item.itemId));
    }
  });

  it("excludes ledger entries from other booths", async () => {
    const summary = (await getBoothSummary(OTHER_BOOTH_ID))!;
    expect(summary.grossCents).toBe(1000);
    expect(summary.items).toEqual([
      { itemId: "coffee", name: "Coffee", qty: 4, revenueCents: 1000 },
    ]);
  });

  it("forbids a non-member with FORBIDDEN", async () => {
    const res = await summaryRoute(summaryRequest(OUTSIDER.uid), summaryContext(BOOTH_ID));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("requires authentication", async () => {
    const res = await summaryRoute(summaryRequest(null), summaryContext(BOOTH_ID));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });
});
