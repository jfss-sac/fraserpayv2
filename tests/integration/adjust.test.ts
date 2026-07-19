import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as adjustRoute } from "../../src/app/api/exec/adjust/route";
import { type LedgerEntryDoc, ledgerCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { buildIdempotencyContext } from "../../src/lib/server/idempotency";
import { adjustBalance } from "../../src/lib/server/money/adjust";
import { pointsFor } from "../../src/lib/shared/money";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { AdjustResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/exec/adjust";

const EXEC = { uid: "adjust-exec", name: "Xavi Exec" };
const MEMBER = { uid: "adjust-member", name: "Mimi Member" };

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
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function makeTopupEntry(studentUid: string, amountCents: number): Promise<string> {
  const ref = await ledgerCol().add({
    type: "topup",
    amountCents,
    direction: "credit",
    balanceAfterCents: amountCents,
    studentUid,
    studentNumber: null,
    studentName: "seed",
    actorUid: EXEC.uid,
    actorName: EXEC.name,
    tags: [],
    idempotencyKey: "seed",
    createdAt: Timestamp.now(),
    createdDate: "2026-07-19",
    method: "cash",
    pointsDelta: pointsFor(amountCents),
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

async function ledgerFor(uid: string): Promise<LedgerEntryDoc[]> {
  return (await ledgerCol().where("studentUid", "==", uid).get()).docs.map((d) => d.data());
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    paymentCode: "fp1-ADJEXC",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    paymentCode: "fp1-ADJMEM",
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
async function freshStudent(
  overrides: { balanceCents?: number; points?: number } = {},
): Promise<{ uid: string; studentNumber: string }> {
  studentSeq += 1;
  const uid = `adjust-student-${studentSeq}`;
  const studentNumber = `9300${studentSeq.toString().padStart(2, "0")}`;
  await makeUser({
    uid,
    displayName: `Student ${studentSeq}`,
    studentNumber,
    paymentCode: `fp1-ADJ${studentSeq.toString().padStart(3, "0")}`,
    ...overrides,
  });
  return { uid, studentNumber };
}

describe("POST /api/exec/adjust", () => {
  it("applies a positive adjustment and leaves points untouched when unlinked", async () => {
    const student = await freshStudent({ balanceCents: 500, points: 30 });
    const res = await adjustRoute(
      post(EXEC.uid, { studentUid: student.uid, amountCents: 500, reason: "cash box correction" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdjustResult;
    expect(body).toEqual({
      entryId: expect.any(String),
      amountCents: 500,
      balanceAfterCents: 1000,
      points: 30,
    });

    const user = (await usersCol().doc(student.uid).get()).data();
    expect(user?.balanceCents).toBe(1000);
    expect(user?.points).toBe(30);

    const [entry] = await ledgerFor(student.uid);
    expect(entry?.type).toBe("adjustment");
    expect(entry?.direction).toBe("credit");
    expect(entry?.amountCents).toBe(500);
    expect(entry?.reason).toBe("cash box correction");
    expect(entry?.pointsDelta).toBeUndefined();
    expect(entry?.originalEntryId).toBeUndefined();
  });

  it("applies a negative adjustment", async () => {
    const student = await freshStudent({ balanceCents: 1000 });
    const res = await adjustRoute(
      post(EXEC.uid, { studentUid: student.uid, amountCents: -500, reason: "double credit" }),
    );
    expect(res.status).toBe(200);
    const entry = (await ledgerFor(student.uid))[0];
    expect(entry?.direction).toBe("debit");
    expect(entry?.amountCents).toBe(500);
    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(500);
  });

  it("rejects a negative adjustment below balance with no writes", async () => {
    const student = await freshStudent({ balanceCents: 300 });
    const res = await adjustRoute(
      post(EXEC.uid, { studentUid: student.uid, amountCents: -500, reason: "over-correction" }),
    );
    expect(res.status).toBe(422);
    expect(await errorCode(res)).toBe("INSUFFICIENT_FUNDS");
    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(300);
    expect(await ledgerFor(student.uid)).toHaveLength(0);
  });

  it("rejects a missing reason with VALIDATION", async () => {
    const student = await freshStudent({ balanceCents: 500 });
    const res = await adjustRoute(post(EXEC.uid, { studentUid: student.uid, amountCents: 500 }));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect(await ledgerFor(student.uid)).toHaveLength(0);
  });

  it("rejects a non-multiple-of-50 amount with VALIDATION", async () => {
    const student = await freshStudent({ balanceCents: 500 });
    const res = await adjustRoute(
      post(EXEC.uid, { studentUid: student.uid, amountCents: 499, reason: "typo" }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rejects a zero amount with VALIDATION", async () => {
    const student = await freshStudent({ balanceCents: 500 });
    const res = await adjustRoute(
      post(EXEC.uid, { studentUid: student.uid, amountCents: 0, reason: "noop" }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rejects a link to another student's top-up with VALIDATION", async () => {
    const owner = await freshStudent({ balanceCents: 1050, points: 52.5 });
    const other = await freshStudent({ balanceCents: 1050, points: 52.5 });
    const topupId = await makeTopupEntry(owner.uid, 1050);
    const res = await adjustRoute(
      post(EXEC.uid, {
        studentUid: other.uid,
        amountCents: -1050,
        reason: "wrong student",
        originalEntryId: topupId,
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect((await usersCol().doc(other.uid).get()).data()?.balanceCents).toBe(1050);
    expect(await ledgerFor(other.uid)).toHaveLength(0);
  });

  it("rejects a link to a non-top-up entry with VALIDATION", async () => {
    const student = await freshStudent({ balanceCents: 1000 });
    const purchaseRef = await ledgerCol().add({
      type: "purchase",
      amountCents: 500,
      direction: "debit",
      balanceAfterCents: 500,
      studentUid: student.uid,
      studentNumber: student.studentNumber,
      studentName: "Student",
      actorUid: EXEC.uid,
      actorName: EXEC.name,
      tags: [],
      idempotencyKey: "seed",
      createdAt: Timestamp.now(),
      createdDate: "2026-07-19",
    });
    const res = await adjustRoute(
      post(EXEC.uid, {
        studentUid: student.uid,
        amountCents: -500,
        reason: "wrong link",
        originalEntryId: purchaseRef.id,
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("reverses points exactly on a linked reversal, including half-points", async () => {
    const student = await freshStudent({ balanceCents: 1050, points: 52.5 });
    const topupId = await makeTopupEntry(student.uid, 1050);
    const res = await adjustRoute(
      post(EXEC.uid, {
        studentUid: student.uid,
        amountCents: -1050,
        reason: "erroneous top-up",
        originalEntryId: topupId,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdjustResult;
    expect(body.points).toBe(0);
    expect(body.balanceAfterCents).toBe(0);

    const user = (await usersCol().doc(student.uid).get()).data();
    expect(user?.points).toBe(0);
    expect(user?.balanceCents).toBe(0);

    const entry = (await ledgerFor(student.uid)).find((e) => e.type === "adjustment");
    expect(entry?.pointsDelta).toBe(-52.5);
    expect(entry?.originalEntryId).toBe(topupId);
  });

  it("never drives points below zero on a linked reversal", async () => {
    const student = await freshStudent({ balanceCents: 1050, points: 20 });
    const topupId = await makeTopupEntry(student.uid, 1050);
    const res = await adjustRoute(
      post(EXEC.uid, {
        studentUid: student.uid,
        amountCents: -1050,
        reason: "erroneous top-up, points already spent",
        originalEntryId: topupId,
      }),
    );
    expect(res.status).toBe(200);
    const user = (await usersCol().doc(student.uid).get()).data();
    expect(user?.points).toBe(0);
    const entry = (await ledgerFor(student.uid)).find((e) => e.type === "adjustment");
    expect(entry?.pointsDelta).toBe(-20);
  });

  it("forbids a non-exec member", async () => {
    const student = await freshStudent({ balanceCents: 500 });
    const res = await adjustRoute(
      post(MEMBER.uid, { studentUid: student.uid, amountCents: 500, reason: "should fail" }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect(await ledgerFor(student.uid)).toHaveLength(0);
  });

  it("replays an identical request without a second ledger entry", async () => {
    const student = await freshStudent({ balanceCents: 500 });
    const key = nextKey();
    const body = { studentUid: student.uid, amountCents: 500, reason: "replay me" };
    const first = (await (await adjustRoute(post(EXEC.uid, body, { key }))).json()) as AdjustResult;
    const second = (await (
      await adjustRoute(post(EXEC.uid, body, { key }))
    ).json()) as AdjustResult;
    expect(second).toEqual(first);
    expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(1000);
    expect(await ledgerFor(student.uid)).toHaveLength(1);
  });
});

describe("adjustBalance concurrency (money module)", () => {
  function ctxFor(actorUid: string, key: string, body: unknown) {
    const request = new Request(`${ORIGIN}${ENDPOINT}`, {
      method: "POST",
      headers: { "idempotency-key": key },
    });
    return buildIdempotencyContext({ request, actorUid, endpoint: ENDPOINT, body });
  }

  it("executes exactly once under a concurrent double-submit (loop)", async () => {
    for (let i = 0; i < 25; i += 1) {
      const student = await freshStudent({ balanceCents: 500 });
      const key = nextKey();
      const body = { studentUid: student.uid, amountCents: 500, reason: "concurrent" };
      const actor = { uid: EXEC.uid, displayName: EXEC.name };
      const ctx = ctxFor(EXEC.uid, key, body);
      const [a, b] = await Promise.all([
        adjustBalance({ input: body, actor, idempotency: ctx }),
        adjustBalance({ input: body, actor, idempotency: ctx }),
      ]);
      expect(a).toEqual(b);
      expect((await usersCol().doc(student.uid).get()).data()?.balanceCents).toBe(1000);
      expect(await ledgerFor(student.uid)).toHaveLength(1);
    }
  }, 120_000);
});
