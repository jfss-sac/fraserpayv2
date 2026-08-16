import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import { GET as historyRoute } from "../../src/app/api/booth/[id]/history/route";
import { BOOTH_HISTORY_PAGE_SIZE, getBoothSummary } from "../../src/lib/server/dal";
import { boothsCol, ledgerCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { buildIdempotencyContext } from "../../src/lib/server/idempotency";
import { refundPurchase } from "../../src/lib/server/money/refund";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothHistoryDTO, BoothItem, ChargeResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const ALPHA = { uid: "history-alpha", name: "Ada Alpha" };
const BRAVO = { uid: "history-bravo", name: "Bo Bravo" };
const EXEC = { uid: "history-exec", name: "Eve Exec" };
const OUTSIDER = { uid: "history-outsider", name: "Otto Outsider" };

const BOOTH_ID = "history-booth";
const OTHER_BOOTH_ID = "history-other-booth";

const ALPHA_PURCHASES = 14;
const BRAVO_PURCHASES = 13;

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false },
];

const BUYERS = [
  { uid: "history-buyer-1", name: "Bea Buyer", studentNumber: "940001", paymentCode: "fp1-HBY001" },
  { uid: "history-buyer-2", name: "Cal Buyer", studentNumber: "940002", paymentCode: "fp1-HBY002" },
];

const cookies: Record<string, string> = {};
let firstPurchase: ChargeResult;
let refundEntryId: string;

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

async function makeBooth(id: string, memberUids: string[]): Promise<void> {
  await boothsCol()
    .doc(id)
    .set({
      name: `Booth ${id}`,
      nameLower: `booth ${id}`,
      description: "test booth",
      status: "approved",
      items: ITEMS.map((item) => ({ ...item })),
      joinCode: "BOOT-6M2P9",
      submitterUid: ALPHA.uid,
      submitterEmail: `${ALPHA.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
  for (const uid of memberUids) {
    await membersCol(id).doc(uid).set({ uid, displayName: uid, joinedAt: Timestamp.now() });
  }
}

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `f47ac10b-58cc-4372-a567-${keyCounter.toString(16).padStart(12, "0")}`;
}

async function charge(
  actorUid: string,
  boothId: string,
  paymentCode: string,
  items: { itemId: string; qty: number }[],
): Promise<ChargeResult> {
  const request = new Request(`${ORIGIN}/api/booth/charge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[actorUid]}`,
      "idempotency-key": nextKey(),
    },
    body: JSON.stringify({ boothId, buyer: { paymentCode }, items }),
  });
  const res = await chargeRoute(request);
  if (res.status !== 200) throw new Error(`charge failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as ChargeResult;
}

async function refund(originalEntryId: string, itemId: string, qty: number): Promise<string> {
  const body = { originalEntryId, reason: "spilled the coffee", lineItems: [{ itemId, qty }] };
  const request = new Request(`${ORIGIN}/api/exec/refund`, {
    method: "POST",
    headers: { "idempotency-key": nextKey() },
  });
  const idempotency = buildIdempotencyContext({
    request,
    actorUid: EXEC.uid,
    role: "sacExec",
    endpoint: "/api/exec/refund",
    body,
  });
  return (await refundPurchase({ input: body, idempotency })).entryId;
}

function historyRequest(actor: string | null, boothId: string, query = ""): Request {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/booth/${boothId}/history${query}`, { method: "GET", headers });
}

async function readHistory(actor: string | null, boothId: string, query = ""): Promise<Response> {
  return historyRoute(historyRequest(actor, boothId, query), {
    params: Promise.resolve({ id: boothId }),
  });
}

async function readPage(actor: string, boothId: string, query = ""): Promise<BoothHistoryDTO> {
  const res = await readHistory(actor, boothId, query);
  if (res.status !== 200) throw new Error(`history failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BoothHistoryDTO;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function ledgerIdsNewestFirst(boothId: string, actorUid?: string): Promise<string[]> {
  const scoped = actorUid
    ? ledgerCol().where("boothId", "==", boothId).where("actorUid", "==", actorUid)
    : ledgerCol().where("boothId", "==", boothId);
  const snap = await scoped.orderBy("createdAt", "desc").get();
  return snap.docs.map((doc) => doc.id);
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({ uid: ALPHA.uid, displayName: ALPHA.name, paymentCode: "fp1-HALPHA" });
  await makeUser({ uid: BRAVO.uid, displayName: BRAVO.name, paymentCode: "fp1-HBRAVO" });
  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    paymentCode: "fp1-HEXECU",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({ uid: OUTSIDER.uid, displayName: OUTSIDER.name, paymentCode: "fp1-HOUTSI" });
  for (const buyer of BUYERS) {
    await makeUser({
      uid: buyer.uid,
      displayName: buyer.name,
      studentNumber: buyer.studentNumber,
      paymentCode: buyer.paymentCode,
      balanceCents: 500_000,
    });
  }
  for (const uid of [ALPHA.uid, BRAVO.uid, OUTSIDER.uid]) {
    cookies[uid] = await mintSessionCookie(uid);
  }

  await makeBooth(BOOTH_ID, [ALPHA.uid, BRAVO.uid]);
  await makeBooth(OTHER_BOOTH_ID, [ALPHA.uid]);

  firstPurchase = await charge(ALPHA.uid, BOOTH_ID, BUYERS[0]!.paymentCode, [
    { itemId: "coffee", qty: 2 },
    { itemId: "cookie", qty: 1 },
  ]);
  for (let i = 1; i < ALPHA_PURCHASES; i += 1) {
    await charge(ALPHA.uid, BOOTH_ID, BUYERS[i % BUYERS.length]!.paymentCode, [
      { itemId: "coffee", qty: 1 },
    ]);
  }
  for (let i = 0; i < BRAVO_PURCHASES; i += 1) {
    await charge(BRAVO.uid, BOOTH_ID, BUYERS[i % BUYERS.length]!.paymentCode, [
      { itemId: "cookie", qty: 2 },
    ]);
  }
  await charge(ALPHA.uid, OTHER_BOOTH_ID, BUYERS[0]!.paymentCode, [{ itemId: "coffee", qty: 1 }]);

  refundEntryId = await refund(firstPurchase.entryId, "coffee", 1);
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "idempotency", "rateLimits"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  await db.recursiveDelete(db.collection("booths"));
  await getAdminAuth()
    .deleteUsers([ALPHA.uid, BRAVO.uid, OUTSIDER.uid])
    .catch(() => undefined);
  vi.restoreAllMocks();
});

describe("GET /api/booth/[id]/history", () => {
  it("lists purchases and refunds for the booth, newest first", async () => {
    const page = await readPage(ALPHA.uid, BOOTH_ID);

    expect(page.entries.length).toBe(BOOTH_HISTORY_PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();
    expect(page.entries.map((e) => e.entryId)).toEqual(
      (await ledgerIdsNewestFirst(BOOTH_ID)).slice(0, BOOTH_HISTORY_PAGE_SIZE),
    );

    const timestamps = page.entries.map((e) => Date.parse(e.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("shows a refund as a credit reversal carrying its purchase's id", async () => {
    const page = await readPage(ALPHA.uid, BOOTH_ID);
    const entry = page.entries.find((e) => e.entryId === refundEntryId);

    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      type: "refund",
      direction: "credit",
      amountCents: 250,
      buyerName: BUYERS[0]!.name,
      actorName: EXEC.name,
      originalEntryId: firstPurchase.entryId,
      lineItems: [{ itemId: "coffee", name: "Coffee", qty: 1, unitPriceCents: 250 }],
    });
  });

  it("sets no-store so a stale page is never served at the counter", async () => {
    const res = await readHistory(ALPHA.uid, BOOTH_ID);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("discloses the buyer's name and nothing about what they hold (NFR-9)", async () => {
    const page = await readPage(ALPHA.uid, BOOTH_ID);

    for (const entry of page.entries) {
      expect(Object.keys(entry).sort()).toEqual(
        entry.type === "refund"
          ? [
              "actorName",
              "amountCents",
              "buyerName",
              "createdAt",
              "direction",
              "entryId",
              "lineItems",
              "originalEntryId",
              "type",
            ]
          : [
              "actorName",
              "amountCents",
              "buyerName",
              "createdAt",
              "direction",
              "entryId",
              "lineItems",
              "type",
            ],
      );
    }

    const serialized = JSON.stringify(page);
    for (const buyer of BUYERS) {
      expect(serialized).toContain(buyer.name);
      expect(serialized).not.toContain(buyer.studentNumber);
      expect(serialized).not.toContain(buyer.paymentCode);
      expect(serialized).not.toContain(buyer.uid);
    }
    expect(serialized).not.toContain("balanceAfterCents");
  });

  it("pages older rows through the cursor without gaps or repeats", async () => {
    const expected = await ledgerIdsNewestFirst(BOOTH_ID);
    expect(expected.length).toBeGreaterThan(BOOTH_HISTORY_PAGE_SIZE);

    const first = await readPage(ALPHA.uid, BOOTH_ID);
    const second = await readPage(ALPHA.uid, BOOTH_ID, `?cursor=${first.nextCursor!}`);

    expect(second.nextCursor).toBeNull();
    expect([...first.entries, ...second.entries].map((e) => e.entryId)).toEqual(expected);
  });

  it("keeps a cursor stable when newer rows arrive between pages", async () => {
    const before = await ledgerIdsNewestFirst(BOOTH_ID);
    const first = await readPage(ALPHA.uid, BOOTH_ID);

    const interloper = ledgerCol().doc();
    await interloper.set({
      type: "purchase",
      amountCents: 150,
      direction: "debit",
      balanceAfterCents: 0,
      studentUid: BUYERS[0]!.uid,
      studentNumber: BUYERS[0]!.studentNumber,
      studentName: BUYERS[0]!.name,
      actorUid: BRAVO.uid,
      actorName: BRAVO.name,
      boothId: BOOTH_ID,
      boothName: `Booth ${BOOTH_ID}`,
      lineItems: [{ itemId: "cookie", name: "Cookie", qty: 1, unitPriceCents: 150 }],
      tags: [],
      idempotencyKey: nextKey(),
      createdAt: Timestamp.now(),
      createdDate: new Date().toISOString().slice(0, 10),
    });

    try {
      const second = await readPage(ALPHA.uid, BOOTH_ID, `?cursor=${first.nextCursor!}`);
      const paged = [...first.entries, ...second.entries].map((e) => e.entryId);

      expect(paged).toEqual(before);
      expect(paged).not.toContain(interloper.id);
      expect(new Set(paged).size).toBe(paged.length);
    } finally {
      await interloper.delete();
    }
  });

  it("filters to the caller's own rows with mine=1", async () => {
    const page = await readPage(ALPHA.uid, BOOTH_ID, "?mine=1");

    expect(page.entries.map((e) => e.entryId)).toEqual(
      await ledgerIdsNewestFirst(BOOTH_ID, ALPHA.uid),
    );
    expect(page.entries.length).toBe(ALPHA_PURCHASES);
    expect(page.nextCursor).toBeNull();
    for (const entry of page.entries) expect(entry.actorName).toBe(ALPHA.name);
    expect(page.entries.map((e) => e.entryId)).not.toContain(refundEntryId);
  });

  it("gives a second member a different mine=1 slice of the same booth", async () => {
    const page = await readPage(BRAVO.uid, BOOTH_ID, "?mine=1");

    expect(page.entries.length).toBe(BRAVO_PURCHASES);
    for (const entry of page.entries) expect(entry.actorName).toBe(BRAVO.name);
  });

  it("never mixes in another booth's rows", async () => {
    const page = await readPage(ALPHA.uid, OTHER_BOOTH_ID);

    expect(page.entries.map((e) => e.entryId)).toEqual(await ledgerIdsNewestFirst(OTHER_BOOTH_ID));
    expect(page.entries.length).toBe(1);
  });

  it("reconciles with the dashboard's gross for the same booth", async () => {
    const entries = [];
    let cursor: string | null = null;
    do {
      const page: BoothHistoryDTO = await readPage(
        ALPHA.uid,
        BOOTH_ID,
        cursor ? `?cursor=${cursor}` : "",
      );
      entries.push(...page.entries);
      cursor = page.nextCursor;
    } while (cursor);

    const gross = entries.reduce(
      (sum, e) => sum + (e.type === "refund" ? -e.amountCents : e.amountCents),
      0,
    );
    expect(gross).toBe((await getBoothSummary(BOOTH_ID))!.grossCents);
  });

  it("forbids a non-member with FORBIDDEN", async () => {
    const res = await readHistory(OUTSIDER.uid, BOOTH_ID);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("forbids a member reading a booth they do not belong to", async () => {
    const res = await readHistory(BRAVO.uid, OTHER_BOOTH_ID);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("requires authentication", async () => {
    const res = await readHistory(null, BOOTH_ID);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it.each(["?cursor=no-such-entry", "?cursor=a/b", "?mine=0", "?limit=500"])(
    "rejects %s with VALIDATION",
    async (query) => {
      const res = await readHistory(ALPHA.uid, BOOTH_ID, query);
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("VALIDATION");
    },
  );

  it("refuses a cursor belonging to another booth", async () => {
    const foreign = (await ledgerIdsNewestFirst(OTHER_BOOTH_ID))[0]!;
    const res = await readHistory(ALPHA.uid, BOOTH_ID, `?cursor=${foreign}`);

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("refuses another member's row as a mine=1 cursor", async () => {
    const theirs = (await ledgerIdsNewestFirst(BOOTH_ID, BRAVO.uid))[0]!;

    expect((await readHistory(ALPHA.uid, BOOTH_ID, `?cursor=${theirs}`)).status).toBe(200);
    const res = await readHistory(ALPHA.uid, BOOTH_ID, `?cursor=${theirs}&mine=1`);
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("returns an empty page for a booth with no sales", async () => {
    await membersCol("history-quiet-booth")
      .doc(ALPHA.uid)
      .set({ uid: ALPHA.uid, displayName: ALPHA.name, joinedAt: Timestamp.now() });

    const page = await readPage(ALPHA.uid, "history-quiet-booth");
    expect(page).toEqual({ entries: [], nextCursor: null });
  });
});
