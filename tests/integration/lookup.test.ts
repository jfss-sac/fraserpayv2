import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as lookupRoute } from "../../src/app/api/booth/lookup/route";
import { boothsCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem, LookupResult } from "../../src/lib/shared/types";

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
      joinCode: "TEST-001",
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
  await Promise.all(["users", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))));
  await db.recursiveDelete(db.collection("booths"));
  vi.restoreAllMocks();
});

describe("POST /api/booth/lookup", () => {
  it("returns exactly name + sufficient — no balance or other field leaks (I10)", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { studentNumber: buyer.studentNumber },
        cartTotalCents: 500,
      }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as LookupResult;
    expect(body).toEqual({ name: buyer.displayName, sufficient: true });
    expect(Object.keys(body).sort()).toEqual(["name", "sufficient"]);
    expect(text).not.toContain("balance");
    expect(text).not.toContain("studentNumber");
    expect(text).not.toContain("paymentCode");
  });

  it("looks a buyer up by payment code", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
        cartTotalCents: 100,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as LookupResult).toEqual({
      name: buyer.displayName,
      sufficient: true,
    });
  });

  it("flips sufficiency exactly at the balance boundary", async () => {
    const buyer = await freshBuyer(1000);

    const exact = (await (
      await lookupRoute(
        post(OPERATOR.uid, {
          boothId: BOOTH_ID,
          buyer: { studentNumber: buyer.studentNumber },
          cartTotalCents: 1000,
        }),
      )
    ).json()) as LookupResult;
    expect(exact.sufficient).toBe(true);

    const over = (await (
      await lookupRoute(
        post(OPERATOR.uid, {
          boothId: BOOTH_ID,
          buyer: { studentNumber: buyer.studentNumber },
          cartTotalCents: 1050,
        }),
      )
    ).json()) as LookupResult;
    expect(over.sufficient).toBe(false);
  });

  it("reports sufficient for an empty cart", async () => {
    const buyer = await freshBuyer(0);
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { studentNumber: buyer.studentNumber },
        cartTotalCents: 0,
      }),
    );
    expect((await res.json()) as LookupResult).toEqual({
      name: buyer.displayName,
      sufficient: true,
    });
  });

  it("returns a generic NOT_FOUND for an unknown buyer", async () => {
    const res = await lookupRoute(
      post(OPERATOR.uid, {
        boothId: BOOTH_ID,
        buyer: { studentNumber: "999999999" },
        cartTotalCents: 100,
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
        buyer: { studentNumber: buyer.studentNumber },
        cartTotalCents: 100,
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
        buyer: { studentNumber: buyer.studentNumber },
        cartTotalCents: 100,
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
        buyer: { studentNumber: buyer.studentNumber },
        cartTotalCents: 100,
        wantBalance: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rate-limits an operator past 30 lookups per minute", async () => {
    const buyer = await freshBuyer(2000);
    const body = {
      boothId: BOOTH_ID,
      buyer: { studentNumber: buyer.studentNumber },
      cartTotalCents: 100,
    };
    const codes: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      codes.push((await lookupRoute(post(RL_OPERATOR.uid, body))).status);
    }
    expect(codes.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});
