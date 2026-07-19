import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as topupRoute } from "../../src/app/api/sac/topup/route";
import { type LedgerEntryDoc, ledgerCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { buildIdempotencyContext } from "../../src/lib/server/idempotency";
import { topUp } from "../../src/lib/server/money/topup";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { TopUpResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/sac/topup";

const MEMBER = { uid: "topup-member", name: "Mimi Member" };
const EXEC = { uid: "topup-exec", name: "Xavi Exec" };
const STUDENT = { uid: "topup-student", name: "Stu Dent" };

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
  points?: number;
  roles?: { sacMember: boolean; sacExec: boolean };
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
      points: args.points ?? 0,
      roles: args.roles ?? { sacMember: false, sacExec: false },
      suspended: args.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
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

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    studentNumber: "900010",
    paymentCode: "fp1-MEMBER",
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    studentNumber: "900011",
    paymentCode: "fp1-EXEC00",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: STUDENT.uid,
    displayName: STUDENT.name,
    studentNumber: "900012",
    paymentCode: "fp1-STUDNT",
    roles: { sacMember: false, sacExec: false },
  });

  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[STUDENT.uid] = await mintSessionCookie(STUDENT.uid);
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

let buyerSeq = 0;
async function freshBuyer(overrides: Partial<Parameters<typeof makeUser>[0]> = {}): Promise<{
  uid: string;
  studentNumber: string;
  paymentCode: string;
}> {
  buyerSeq += 1;
  const uid = `topup-buyer-${buyerSeq}`;
  const studentNumber = `9100${buyerSeq.toString().padStart(2, "0")}`;
  const paymentCode = `fp1-BUY${buyerSeq.toString().padStart(3, "0")}`;
  await makeUser({
    uid,
    displayName: `Buyer ${buyerSeq}`,
    studentNumber,
    paymentCode,
    ...overrides,
  });
  return { uid, studentNumber, paymentCode };
}

describe("POST /api/sac/topup", () => {
  it("tops up a student and grants half-points (52.5 case)", async () => {
    const buyer = await freshBuyer();
    const res = await topupRoute(
      post(MEMBER.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 1050,
        method: "cash",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as TopUpResult;
    expect(body).toEqual({
      entryId: expect.any(String),
      amountCents: 1050,
      balanceAfterCents: 1050,
      points: 52.5,
    });

    const user = (await usersCol().doc(buyer.uid).get()).data();
    expect(user?.balanceCents).toBe(1050);
    expect(user?.points).toBe(52.5);

    const entries = await ledgerFor(buyer.uid);
    expect(entries).toHaveLength(1);
  });

  it("resolves the buyer by payment code too", async () => {
    const buyer = await freshBuyer();
    const res = await topupRoute(
      post(MEMBER.uid, {
        buyer: { paymentCode: buyer.paymentCode },
        amountCents: 500,
        method: "card",
      }),
    );
    expect(res.status).toBe(200);
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(500);
  });

  it("rejects a non-multiple-of-50 amount with VALIDATION", async () => {
    const buyer = await freshBuyer();
    const res = await topupRoute(
      post(MEMBER.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 4999,
        method: "cash",
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("rejects an over-$100 top-up from a member with CAP_EXCEEDED and no writes", async () => {
    const buyer = await freshBuyer();
    const res = await topupRoute(
      post(MEMBER.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 10_050,
        method: "cash",
      }),
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("CAP_EXCEEDED");
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(0);
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("rejects an over-cap top-up from an exec missing a reason", async () => {
    const buyer = await freshBuyer();
    const res = await topupRoute(
      post(EXEC.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 10_050,
        method: "cash",
      }),
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("CAP_EXCEEDED");
  });

  it("lets an exec override the top-up cap with a reason and tags cap-override", async () => {
    const buyer = await freshBuyer();
    const res = await topupRoute(
      post(EXEC.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 10_050,
        method: "cash",
        overrideReason: "class trip prepayment",
      }),
    );
    expect(res.status).toBe(200);
    const entries = await ledgerFor(buyer.uid);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.tags).toContain("cap-override");
    expect(entries[0]!.reason).toBe("class trip prepayment");
  });

  it("blocks a top-up that pushes the balance over $200 for a member", async () => {
    const buyer = await freshBuyer({ balanceCents: 19_900 });
    const res = await topupRoute(
      post(MEMBER.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 500,
        method: "cash",
      }),
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("CAP_EXCEEDED");
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(19_900);
  });

  it("lets an exec override the balance cap with a reason", async () => {
    const buyer = await freshBuyer({ balanceCents: 19_900 });
    const res = await topupRoute(
      post(EXEC.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 500,
        method: "cash",
        overrideReason: "reconciliation correction",
      }),
    );
    expect(res.status).toBe(200);
    const entries = await ledgerFor(buyer.uid);
    expect(entries[0]!.tags).toContain("cap-override");
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(20_400);
  });

  it("rejects a suspended buyer with SUSPENDED", async () => {
    const buyer = await freshBuyer({ suspended: true });
    const res = await topupRoute(
      post(MEMBER.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 500,
        method: "cash",
      }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("SUSPENDED");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("forbids a non-SAC student caller", async () => {
    const buyer = await freshBuyer();
    const res = await topupRoute(
      post(STUDENT.uid, {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 500,
        method: "cash",
      }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("replays an identical request without a second ledger entry", async () => {
    const buyer = await freshBuyer();
    const key = nextKey();
    const body = {
      buyer: { studentNumber: buyer.studentNumber },
      amountCents: 500,
      method: "cash" as const,
    };
    const first = (await (await topupRoute(post(MEMBER.uid, body, { key }))).json()) as TopUpResult;
    const second = (await (
      await topupRoute(post(MEMBER.uid, body, { key }))
    ).json()) as TopUpResult;
    expect(second).toEqual(first);
    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(500);
    expect(await ledgerFor(buyer.uid)).toHaveLength(1);
  });

  it("stores the full ledger entry shape", async () => {
    const buyer = await freshBuyer();
    const key = nextKey();
    const res = await topupRoute(
      post(
        MEMBER.uid,
        {
          buyer: { studentNumber: buyer.studentNumber },
          amountCents: 2000,
          method: "card",
        },
        { key },
      ),
    );
    expect(res.status).toBe(200);
    const [entry] = await ledgerFor(buyer.uid);
    const { createdAt, ...rest } = entry!;
    expect(createdAt).toBeInstanceOf(Timestamp);
    expect(rest).toEqual({
      type: "topup",
      amountCents: 2000,
      direction: "credit",
      balanceAfterCents: 2000,
      studentUid: buyer.uid,
      studentNumber: buyer.studentNumber,
      studentName: `Buyer ${buyerSeq}`,
      actorUid: MEMBER.uid,
      actorName: MEMBER.name,
      tags: [],
      idempotencyKey: key,
      createdDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      method: "card",
      pointsDelta: 100,
    });
  });
});

describe("topUp concurrency (money module)", () => {
  function ctxFor(actorUid: string, key: string, body: unknown) {
    const request = new Request(`${ORIGIN}${ENDPOINT}`, {
      method: "POST",
      headers: { "idempotency-key": key },
    });
    return buildIdempotencyContext({ request, actorUid, endpoint: ENDPOINT, body });
  }

  it("executes exactly once under a concurrent double-submit (loop)", async () => {
    for (let i = 0; i < 25; i += 1) {
      const buyer = await freshBuyer();
      const key = nextKey();
      const body = {
        buyer: { studentNumber: buyer.studentNumber },
        amountCents: 500,
        method: "cash" as const,
      };
      const actor = { uid: MEMBER.uid, displayName: MEMBER.name, isExec: false };
      const ctx = ctxFor(MEMBER.uid, key, body);
      const [a, b] = await Promise.all([
        topUp({ input: body, actor, idempotency: ctx }),
        topUp({ input: body, actor, idempotency: ctx }),
      ]);
      expect(a).toEqual(b);
      expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(500);
      expect(await ledgerFor(buyer.uid)).toHaveLength(1);
    }
  }, 120_000);
});
