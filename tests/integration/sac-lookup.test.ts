import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as sacLookupRoute } from "../../src/app/api/sac/lookup/route";
import { usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { RATE_LIMITS } from "../../src/lib/server/ratelimit";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { SacLookupResult } from "../../src/lib/shared/types";

const RATE_LIMIT_SWEEP_TIMEOUT_MS = 60_000;

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/sac/lookup";

const MEMBER = { uid: "sac-lookup-member", name: "Mimi Member" };
const EXEC = { uid: "sac-lookup-exec", name: "Xavi Exec" };
const STUDENT = { uid: "sac-lookup-student", name: "Stu Dent" };
const RL_MEMBER = { uid: "sac-lookup-rl-member", name: "Rex Ratelimit" };

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
async function freshBuyer(overrides: Partial<Parameters<typeof makeUser>[0]> = {}): Promise<{
  uid: string;
  studentNumber: string;
  paymentCode: string;
  displayName: string;
}> {
  buyerSeq += 1;
  const uid = `sac-lookup-buyer-${buyerSeq}`;
  const studentNumber = `9200${buyerSeq.toString().padStart(2, "0")}`;
  const paymentCode = `fp1-SLK${buyerSeq.toString().padStart(3, "0")}`;
  const displayName = `Buyer ${buyerSeq}`;
  await makeUser({ uid, displayName, studentNumber, paymentCode, ...overrides });
  return { uid, studentNumber, paymentCode, displayName };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    studentNumber: "920500",
    paymentCode: "fp1-SLMEMB",
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    studentNumber: "920501",
    paymentCode: "fp1-SLEXEC",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: STUDENT.uid,
    displayName: STUDENT.name,
    studentNumber: "920502",
    paymentCode: "fp1-SLSTUD",
    roles: { sacMember: false, sacExec: false },
  });
  await makeUser({
    uid: RL_MEMBER.uid,
    displayName: RL_MEMBER.name,
    studentNumber: "920503",
    paymentCode: "fp1-SLRATE",
    roles: { sacMember: true, sacExec: false },
  });

  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[STUDENT.uid] = await mintSessionCookie(STUDENT.uid);
  cookies[RL_MEMBER.uid] = await mintSessionCookie(RL_MEMBER.uid);
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(["users", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))));
  vi.restoreAllMocks();
});

describe("POST /api/sac/lookup", () => {
  it("resolves a buyer by student number and returns name, balance and points", async () => {
    const buyer = await freshBuyer({ balanceCents: 1550, points: 77.5 });
    const res = await sacLookupRoute(
      post(MEMBER.uid, { buyer: { studentNumber: buyer.studentNumber } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as SacLookupResult;
    expect(body).toEqual({ name: buyer.displayName, balanceCents: 1550, points: 77.5 });
    expect(Object.keys(body).sort()).toEqual(["balanceCents", "name", "points"]);
  });

  it("resolves a buyer by payment code (the scanned-QR path)", async () => {
    const buyer = await freshBuyer({ balanceCents: 500 });
    const res = await sacLookupRoute(
      post(MEMBER.uid, { buyer: { paymentCode: buyer.paymentCode } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as SacLookupResult).toEqual({
      name: buyer.displayName,
      balanceCents: 500,
      points: 0,
    });
  });

  it("lets an exec look up too (exec implies member)", async () => {
    const buyer = await freshBuyer({ balanceCents: 200 });
    const res = await sacLookupRoute(
      post(EXEC.uid, { buyer: { studentNumber: buyer.studentNumber } }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as SacLookupResult).balanceCents).toBe(200);
  });

  it("forbids a non-SAC student caller (defense-in-depth on top of the nav gate)", async () => {
    const buyer = await freshBuyer();
    const res = await sacLookupRoute(
      post(STUDENT.uid, { buyer: { studentNumber: buyer.studentNumber } }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("returns a generic NOT_FOUND for an unknown buyer", async () => {
    const res = await sacLookupRoute(post(MEMBER.uid, { buyer: { studentNumber: "999999999" } }));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("rejects a suspended buyer with SUSPENDED (top-up would be blocked, A3)", async () => {
    const buyer = await freshBuyer({ suspended: true });
    const res = await sacLookupRoute(
      post(MEMBER.uid, { buyer: { studentNumber: buyer.studentNumber } }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("SUSPENDED");
  });

  it("rejects unknown fields in the body (strict scope)", async () => {
    const buyer = await freshBuyer();
    const res = await sacLookupRoute(
      post(MEMBER.uid, { buyer: { studentNumber: buyer.studentNumber }, wantSecrets: true }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it(
    "rate-limits a member past the per-minute lookup cap",
    async () => {
      const buyer = await freshBuyer();
      const body = { buyer: { studentNumber: buyer.studentNumber } };
      const { limit } = RATE_LIMITS.lookup;
      const codes: number[] = [];
      for (let i = 0; i < limit + 1; i += 1) {
        codes.push((await sacLookupRoute(post(RL_MEMBER.uid, body))).status);
      }
      expect(codes.slice(0, limit).every((s) => s === 200)).toBe(true);
      expect(codes[limit]).toBe(429);
    },
    RATE_LIMIT_SWEEP_TIMEOUT_MS,
  );
});
