import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as refundRoute } from "../../src/app/api/exec/refund/route";
import { type LedgerEntryDoc, ledgerCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { buildIdempotencyContext } from "../../src/lib/server/idempotency";
import { refundPurchase } from "../../src/lib/server/money/refund";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { LedgerLineItem, RefundResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/exec/refund";

const BOOTH_ID = "refund-booth";
const BOOTH_NAME = "Booth refund-booth";

const EXEC = { uid: "refund-exec", name: "Xavi Exec" };
const MEMBER = { uid: "refund-member", name: "Mimi Member" };

const COFFEE: LedgerLineItem = { itemId: "coffee", name: "Coffee", qty: 2, unitPriceCents: 250 };
const COOKIE: LedgerLineItem = { itemId: "cookie", name: "Cookie", qty: 1, unitPriceCents: 150 };

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
  roles?: { sacMember: boolean; sacExec: boolean };
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
      roles: args.roles ?? { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function makePurchase(studentUid: string, lineItems: LedgerLineItem[]): Promise<string> {
  const amountCents = lineItems.reduce((s, li) => s + li.qty * li.unitPriceCents, 0);
  const ref = await ledgerCol().add({
    type: "purchase",
    amountCents,
    direction: "debit",
    balanceAfterCents: 0,
    studentUid,
    studentNumber: null,
    studentName: "seed",
    actorUid: EXEC.uid,
    actorName: EXEC.name,
    boothId: BOOTH_ID,
    boothName: BOOTH_NAME,
    lineItems,
    tags: [],
    idempotencyKey: "seed",
    createdAt: Timestamp.now(),
    createdDate: "2026-07-19",
  });
  return ref.id;
}

let uuidCounter = 0;
function nextKey(): string {
  uuidCounter += 1;
  const n = uuidCounter.toString(16).padStart(12, "0");
  return `f47ac10b-58cc-4372-a567-${n}`;
}

function post(actor: string, body: unknown, opts: { key?: string | undefined } = {}): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}`,
  };
  const key = "key" in opts ? opts.key : nextKey();
  if (key !== undefined) headers["idempotency-key"] = key;
  return new Request(`${ORIGIN}${ENDPOINT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function refundsFor(originalEntryId: string): Promise<LedgerEntryDoc[]> {
  return (await ledgerCol().where("originalEntryId", "==", originalEntryId).get()).docs.map((d) =>
    d.data(),
  );
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    paymentCode: "fp1-REFEXC",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    paymentCode: "fp1-REFMEM",
    roles: { sacMember: true, sacExec: false },
  });
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "idempotency", "rateLimits"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  vi.restoreAllMocks();
});

let studentSeq = 0;
async function freshStudent(balanceCents: number): Promise<{ uid: string; studentNumber: string }> {
  studentSeq += 1;
  const uid = `refund-student-${studentSeq}`;
  const studentNumber = `9400${studentSeq.toString().padStart(2, "0")}`;
  await makeUser({
    uid,
    displayName: `Student ${studentSeq}`,
    studentNumber,
    paymentCode: `fp1-REF${studentSeq.toString().padStart(3, "0")}`,
    balanceCents,
  });
  return { uid, studentNumber };
}

describe("POST /api/exec/refund", () => {
  it("fully refunds a purchase and restores the exact balance", async () => {
    const student = await freshStudent(0);
    const purchaseId = await makePurchase(student.uid, [COFFEE]);
    const res = await refundRoute(
      post(EXEC.uid, { originalEntryId: purchaseId, reason: "dispute" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RefundResult;
    expect(body).toEqual({ entryId: expect.any(String), amountCents: 500, balanceAfterCents: 500 });

    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(500);

    const refunds = (await refundsFor(purchaseId)).filter((e) => e.type === "refund");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.direction).toBe("credit");
    expect(refunds[0]!.boothId).toBe(BOOTH_ID);
    expect(refunds[0]!.boothName).toBe(BOOTH_NAME);
    expect(refunds[0]!.lineItems).toEqual([
      { itemId: "coffee", name: "Coffee", qty: 2, unitPriceCents: 250 },
    ]);
  });

  it("refunds a single line item on a multi-line purchase", async () => {
    const student = await freshStudent(350);
    const purchaseId = await makePurchase(student.uid, [COFFEE, COOKIE]);
    const res = await refundRoute(
      post(EXEC.uid, {
        originalEntryId: purchaseId,
        reason: "one coffee spilled",
        lineItems: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as RefundResult;
    expect(body.amountCents).toBe(250);
    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(600);
    const refund = (await refundsFor(purchaseId)).find((e) => e.type === "refund");
    expect(refund?.lineItems).toEqual([
      { itemId: "coffee", name: "Coffee", qty: 1, unitPriceCents: 250 },
    ]);
  });

  it("rejects refunding a line beyond the original quantity with CONFLICT", async () => {
    const student = await freshStudent(0);
    const purchaseId = await makePurchase(student.uid, [COFFEE]);
    await refundRoute(
      post(EXEC.uid, {
        originalEntryId: purchaseId,
        reason: "first",
        lineItems: [{ itemId: "coffee", qty: 2 }],
      }),
    );
    const res = await refundRoute(
      post(EXEC.uid, {
        originalEntryId: purchaseId,
        reason: "again",
        lineItems: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
    const refunds = (await refundsFor(purchaseId)).filter((e) => e.type === "refund");
    expect(refunds).toHaveLength(1);
    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(500);
  });

  it("rejects refunding an item that was not in the original purchase with VALIDATION", async () => {
    const student = await freshStudent(0);
    const purchaseId = await makePurchase(student.uid, [COFFEE]);
    const res = await refundRoute(
      post(EXEC.uid, {
        originalEntryId: purchaseId,
        reason: "wrong item",
        lineItems: [{ itemId: "cookie", qty: 1 }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rejects refunding a refund with VALIDATION", async () => {
    const student = await freshStudent(0);
    const purchaseId = await makePurchase(student.uid, [COFFEE]);
    const first = (await (
      await refundRoute(post(EXEC.uid, { originalEntryId: purchaseId, reason: "refund it" }))
    ).json()) as RefundResult;
    const res = await refundRoute(
      post(EXEC.uid, { originalEntryId: first.entryId, reason: "refund the refund" }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("credits a refund past the $200 balance cap (cap does not apply)", async () => {
    const student = await freshStudent(19_900);
    const purchaseId = await makePurchase(student.uid, [COFFEE]);
    const res = await refundRoute(
      post(EXEC.uid, { originalEntryId: purchaseId, reason: "over-cap refund" }),
    );
    expect(res.status).toBe(200);
    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(20_400);
  });

  it("forbids a non-exec member", async () => {
    const student = await freshStudent(0);
    const purchaseId = await makePurchase(student.uid, [COFFEE]);
    const res = await refundRoute(
      post(MEMBER.uid, { originalEntryId: purchaseId, reason: "should fail" }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect((await refundsFor(purchaseId)).filter((e) => e.type === "refund")).toHaveLength(0);
  });

  it("replays an identical request without a second refund entry", async () => {
    const student = await freshStudent(0);
    const purchaseId = await makePurchase(student.uid, [COFFEE]);
    const key = nextKey();
    const body = { originalEntryId: purchaseId, reason: "replay" };
    const first = (await (await refundRoute(post(EXEC.uid, body, { key }))).json()) as RefundResult;
    const second = (await (
      await refundRoute(post(EXEC.uid, body, { key }))
    ).json()) as RefundResult;
    expect(second).toEqual(first);
    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(500);
    expect((await refundsFor(purchaseId)).filter((e) => e.type === "refund")).toHaveLength(1);
  });
});

describe("refundPurchase concurrency (money module)", () => {
  function ctxFor(actorUid: string, key: string, body: unknown) {
    const request = new Request(`${ORIGIN}${ENDPOINT}`, {
      method: "POST",
      headers: { "idempotency-key": key },
    });
    return buildIdempotencyContext({ request, actorUid, endpoint: ENDPOINT, body });
  }

  const actor = { uid: EXEC.uid, displayName: EXEC.name };

  it("executes exactly once under a concurrent double-submit (loop)", async () => {
    for (let i = 0; i < 25; i += 1) {
      const student = await freshStudent(0);
      const purchaseId = await makePurchase(student.uid, [COFFEE]);
      const key = nextKey();
      const body = { originalEntryId: purchaseId, reason: "concurrent replay" };
      const ctx = ctxFor(EXEC.uid, key, body);
      const [a, b] = await Promise.all([
        refundPurchase({ input: body, actor, idempotency: ctx }),
        refundPurchase({ input: body, actor, idempotency: ctx }),
      ]);
      expect(a).toEqual(b);
      expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(500);
      expect((await refundsFor(purchaseId)).filter((e) => e.type === "refund")).toHaveLength(1);
    }
  }, 120_000);

  it("never double-refunds a purchase under two distinct concurrent requests (loop)", async () => {
    for (let i = 0; i < 25; i += 1) {
      const student = await freshStudent(0);
      const purchaseId = await makePurchase(student.uid, [COFFEE]);
      const body = { originalEntryId: purchaseId, reason: "race" };
      const results = await Promise.allSettled([
        refundPurchase({
          input: body,
          actor,
          idempotency: ctxFor(EXEC.uid, nextKey(), body),
        }),
        refundPurchase({
          input: body,
          actor,
          idempotency: ctxFor(EXEC.uid, nextKey(), body),
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(500);
      expect((await refundsFor(purchaseId)).filter((e) => e.type === "refund")).toHaveLength(1);
    }
  }, 120_000);
});
