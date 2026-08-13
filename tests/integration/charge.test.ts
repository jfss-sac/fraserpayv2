import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import {
  type LedgerEntryDoc,
  boothsCol,
  ledgerCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { charge } from "../../src/lib/server/money/charge";
import { buildIdempotencyContext } from "../../src/lib/server/idempotency";
import { RATE_LIMITS } from "../../src/lib/server/ratelimit";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem, ChargeResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/booth/charge";

const OPERATOR = { uid: "charge-operator", name: "Opal Operator" };
const OUTSIDER = { uid: "charge-outsider", name: "Otto Outsider" };
const QUOTA_OPERATOR = { uid: "charge-quota-operator", name: "Quinn Quota" };

const BOOTH_ID = "charge-booth";
const PENDING_BOOTH_ID = "charge-booth-pending";
const DEACTIVATED_BOOTH_ID = "charge-booth-deactivated";

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

async function makeBooth(
  id: string,
  status: "pending" | "approved" | "deactivated",
): Promise<void> {
  await boothsCol()
    .doc(id)
    .set({
      name: `Booth ${id}`,
      nameLower: `booth ${id}`,
      description: "test booth",
      status,
      items: ITEMS,
      joinCode: status === "approved" ? "BOOT-8S5T2" : null,
      submitterUid: OPERATOR.uid,
      submitterEmail: `${OPERATOR.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
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

async function ledgerFor(uid: string): Promise<LedgerEntryDoc[]> {
  return (await ledgerCol().where("studentUid", "==", uid).get()).docs.map((d) => d.data());
}

async function chargeWindows(uid: string): Promise<{ count: number; refunds: number }[]> {
  const snap = await getAdminFirestore().collection("rateLimits").get();
  return snap.docs
    .filter((d) => d.id.startsWith(`charge_${uid}_`))
    .map((d) => ({
      count: (d.data().count as number | undefined) ?? 0,
      refunds: (d.data().refunds as number | undefined) ?? 0,
    }));
}

async function chargeQuotaUsed(uid: string): Promise<number> {
  const { limit } = RATE_LIMITS.charge;
  return (await chargeWindows(uid)).reduce(
    (sum, w) => sum + w.count - Math.min(w.refunds, limit),
    0,
  );
}

async function chargeRequestsSeen(uid: string): Promise<number> {
  return (await chargeWindows(uid)).reduce((sum, w) => sum + w.count, 0);
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({ uid: OPERATOR.uid, displayName: OPERATOR.name, paymentCode: "fp1-OPERAT" });
  await makeUser({ uid: OUTSIDER.uid, displayName: OUTSIDER.name, paymentCode: "fp1-OUTSID" });
  await makeUser({
    uid: QUOTA_OPERATOR.uid,
    displayName: QUOTA_OPERATOR.name,
    paymentCode: "fp1-QUOTAO",
  });
  cookies[OPERATOR.uid] = await mintSessionCookie(OPERATOR.uid);
  cookies[OUTSIDER.uid] = await mintSessionCookie(OUTSIDER.uid);
  cookies[QUOTA_OPERATOR.uid] = await mintSessionCookie(QUOTA_OPERATOR.uid);

  await makeBooth(BOOTH_ID, "approved");
  await makeBooth(PENDING_BOOTH_ID, "pending");
  await makeBooth(DEACTIVATED_BOOTH_ID, "deactivated");

  for (const id of [BOOTH_ID, PENDING_BOOTH_ID, DEACTIVATED_BOOTH_ID]) {
    await membersCol(id)
      .doc(OPERATOR.uid)
      .set({ uid: OPERATOR.uid, displayName: OPERATOR.name, joinedAt: Timestamp.now() });
  }
  await membersCol(BOOTH_ID)
    .doc(QUOTA_OPERATOR.uid)
    .set({ uid: QUOTA_OPERATOR.uid, displayName: QUOTA_OPERATOR.name, joinedAt: Timestamp.now() });
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

let buyerSeq = 0;
async function freshBuyer(
  balanceCents: number,
  overrides: { suspended?: boolean } = {},
): Promise<{
  uid: string;
  studentNumber: string;
  paymentCode: string;
}> {
  buyerSeq += 1;
  const uid = `charge-buyer-${buyerSeq}`;
  const studentNumber = `9200${buyerSeq.toString().padStart(2, "0")}`;
  const paymentCode = `fp1-BYR${buyerSeq.toString().padStart(3, "0")}`;
  await makeUser({
    uid,
    displayName: `Buyer ${buyerSeq}`,
    studentNumber,
    paymentCode,
    balanceCents,
    ...overrides,
  });
  return { uid, studentNumber, paymentCode };
}

describe("POST /api/booth/charge", () => {
  it("charges an operator who is also the buyer, reading one document for both roles", async () => {
    await usersCol().doc(OPERATOR.uid).update({ balanceCents: 1000, updatedAt: Timestamp.now() });
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: "fp1-OPERAT" },
        items: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(200);
    expect((await usersCol().doc(OPERATOR.uid).get()).data()?.balanceCents).toBe(750);
    const entries = await ledgerFor(OPERATOR.uid);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      studentUid: OPERATOR.uid,
      actorUid: OPERATOR.uid,
      actorName: OPERATOR.name,
      balanceAfterCents: 750,
    });
    await usersCol().doc(OPERATOR.uid).update({ balanceCents: 0, updatedAt: Timestamp.now() });
  });

  it("charges a multi-line cart with custom items and prices from the booth doc", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [
          { itemId: "coffee", qty: 2 },
          { itemId: "custom", qty: 3 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChargeResult;
    expect(body).toEqual({ entryId: expect.any(String), amountCents: 650 });

    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(1350);
    const entries = await ledgerFor(buyer.uid);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.lineItems).toEqual([
      { itemId: "coffee", name: "Coffee", qty: 2, unitPriceCents: 250 },
      { itemId: "custom", name: "Custom", qty: 3, unitPriceCents: 50 },
    ]);
    expect(entries[0]!.boothId).toBe(BOOTH_ID);
    expect(entries[0]!.boothName).toBe(`Booth ${BOOTH_ID}`);
    expect(entries[0]!.direction).toBe("debit");
  });

  it("allows an exact-balance purchase down to zero", async () => {
    const buyer = await freshBuyer(400);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [
          { itemId: "coffee", qty: 1 },
          { itemId: "cookie", qty: 1 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(0);
  });

  it("rejects a cart just over the balance with no writes", async () => {
    const buyer = await freshBuyer(350);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [
          { itemId: "coffee", qty: 1 },
          { itemId: "cookie", qty: 1 },
        ],
      }),
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("INSUFFICIENT_FUNDS");
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(350);
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("rejects a pending booth with BOOTH_NOT_SELLABLE", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: PENDING_BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("BOOTH_NOT_SELLABLE");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("rejects a deactivated booth with BOOTH_NOT_SELLABLE", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: DEACTIVATED_BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("BOOTH_NOT_SELLABLE");
  });

  it("rejects an itemId not sold at the booth with BOOTH_NOT_SELLABLE", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "not-on-menu", qty: 1 }],
      }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("BOOTH_NOT_SELLABLE");
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(2000);
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("refuses to charge a student-number buyer — a guessed number moves no money", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { studentNumber: buyer.studentNumber },
        items: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(2000);
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("rejects a buyer that matches no student with NOT_FOUND", async () => {
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: "fp1-NOSUCHBUYER" },
        items: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("forbids an operator who is not a member of the booth", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post(OUTSIDER.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("rejects a suspended buyer with SUSPENDED and no writes", async () => {
    const buyer = await freshBuyer(2000, { suspended: true });
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "coffee", qty: 1 }],
      }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("SUSPENDED");
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(2000);
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("ignores a client-supplied price by rejecting unknown fields", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "coffee", qty: 1, priceCents: 1 }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("does not tag a purchase of exactly $15.00 as high-amount", async () => {
    const buyer = await freshBuyer(2000);
    await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "custom", qty: 30 }],
      }),
    );
    const entries = await ledgerFor(buyer.uid);
    expect(entries[0]!.amountCents).toBe(1500);
    expect(entries[0]!.tags).toEqual([]);
  });

  it("tags a purchase of $15.50 as high-amount", async () => {
    const buyer = await freshBuyer(2000);
    await chargeRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "custom", qty: 31 }],
      }),
    );
    const entries = await ledgerFor(buyer.uid);
    expect(entries[0]!.amountCents).toBe(1550);
    expect(entries[0]!.tags).toContain("high-amount");
  });

  it("replays an identical request without a second ledger entry", async () => {
    const buyer = await freshBuyer(2000);
    const key = nextKey();
    const body = {
      boothId: BOOTH_ID,
      buyer: { paymentCode: buyer.paymentCode },
      items: [{ itemId: "coffee", qty: 2 }],
    };
    const firstRes = await chargeRoute(post(OPERATOR.uid, body, { key }));
    const secondRes = await chargeRoute(post(OPERATOR.uid, body, { key }));
    const first = (await firstRes.json()) as ChargeResult;
    const second = (await secondRes.json()) as ChargeResult;
    expect(second).toEqual(first);
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(1500);
    expect(await ledgerFor(buyer.uid)).toHaveLength(1);
  });

  it("replays a committed charge after the buyer's payment code is regenerated (I5)", async () => {
    const buyer = await freshBuyer(2000);
    const key = nextKey();
    const body = {
      boothId: BOOTH_ID,
      buyer: { paymentCode: buyer.paymentCode },
      items: [{ itemId: "coffee", qty: 2 }],
    };
    const firstRes = await chargeRoute(post(OPERATOR.uid, body, { key }));
    expect(firstRes.status).toBe(200);

    await usersCol()
      .doc(buyer.uid)
      .update({ paymentCode: `${buyer.paymentCode}-R`, updatedAt: Timestamp.now() });

    const replayRes = await chargeRoute(post(OPERATOR.uid, body, { key }));
    expect(replayRes.status).toBe(200);
    expect(replayRes.headers.get("idempotent-replay")).toBe("true");
    expect(await replayRes.text()).toBe(await firstRes.text());

    const freshRes = await chargeRoute(post(OPERATOR.uid, body));
    expect(freshRes.status).toBe(404);
    expect(await errorCode(freshRes)).toBe("NOT_FOUND");

    expect(await ledgerFor(buyer.uid)).toHaveLength(1);
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(1500);
  });

  it("flags the replay with Idempotent-Replay and leaves the body identical (§9.2)", async () => {
    const buyer = await freshBuyer(2000);
    const key = nextKey();
    const body = {
      boothId: BOOTH_ID,
      buyer: { paymentCode: buyer.paymentCode },
      items: [{ itemId: "coffee", qty: 2 }],
    };
    const firstRes = await chargeRoute(post(OPERATOR.uid, body, { key }));
    const secondRes = await chargeRoute(post(OPERATOR.uid, body, { key }));

    expect(firstRes.headers.get("idempotent-replay")).toBeNull();
    expect(secondRes.headers.get("idempotent-replay")).toBe("true");
    expect(await secondRes.text()).toBe(await firstRes.text());
  });

  it("spends no rate-limit quota on an idempotent replay", async () => {
    const buyer = await freshBuyer(2000);
    const key = nextKey();
    const body = {
      boothId: BOOTH_ID,
      buyer: { paymentCode: buyer.paymentCode },
      items: [{ itemId: "coffee", qty: 1 }],
    };

    for (let i = 0; i < 3; i += 1) {
      expect((await chargeRoute(post(QUOTA_OPERATOR.uid, body, { key }))).status).toBe(200);
    }

    expect(await ledgerFor(buyer.uid)).toHaveLength(1);
    expect(await chargeQuotaUsed(QUOTA_OPERATOR.uid)).toBe(1);
    expect(await chargeRequestsSeen(QUOTA_OPERATOR.uid)).toBe(3);
  });

  it("keeps request and response bodies each under 2 KB (NFR-3)", async () => {
    const buyer = await freshBuyer(2000);
    const requestBody = {
      boothId: BOOTH_ID,
      buyer: { paymentCode: buyer.paymentCode },
      items: [
        { itemId: "coffee", qty: 2 },
        { itemId: "cookie", qty: 2 },
        { itemId: "custom", qty: 3 },
      ],
    };
    const requestBytes = Buffer.byteLength(JSON.stringify(requestBody), "utf8");
    const res = await chargeRoute(post(OPERATOR.uid, requestBody));
    const text = await res.text();
    const responseBytes = Buffer.byteLength(text, "utf8");
    console.info(
      `[nfr-3] charge request ${requestBytes} B, response ${responseBytes} B (limit 2048)`,
    );
    expect(requestBytes).toBeLessThan(2048);
    expect(responseBytes).toBeLessThan(2048);
    expect(text).not.toContain("balance");
  });
});

describe("charge concurrency (money module)", () => {
  function ctxFor(actorUid: string, key: string, body: unknown) {
    const request = new Request(`${ORIGIN}${ENDPOINT}`, {
      method: "POST",
      headers: { "idempotency-key": key },
    });
    return buildIdempotencyContext({ request, actorUid, role: "active", endpoint: ENDPOINT, body });
  }

  it("executes exactly once under a concurrent double-submit (loop)", async () => {
    for (let i = 0; i < 25; i += 1) {
      const buyer = await freshBuyer(2000);
      const key = nextKey();
      const body = {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        items: [{ itemId: "coffee", qty: 2 }],
      };
      const ctx = ctxFor(OPERATOR.uid, key, body);
      const [a, b] = await Promise.all([
        charge({ input: body, idempotency: ctx }),
        charge({ input: body, idempotency: ctx }),
      ]);
      expect(a).toEqual(b);
      expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(1500);
      expect(await ledgerFor(buyer.uid)).toHaveLength(1);
    }
  }, 120_000);
});
