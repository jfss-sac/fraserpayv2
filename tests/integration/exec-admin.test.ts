import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as regenRoute } from "../../src/app/api/exec/payment-code/route";
import { POST as suspendRoute } from "../../src/app/api/exec/suspend/route";
import { POST as rolesRoute } from "../../src/app/api/exec/roles/route";
import { POST as lookupRoute } from "../../src/app/api/sac/lookup/route";
import { POST as topupRoute } from "../../src/app/api/sac/topup/route";
import { GET as studentsRoute } from "../../src/app/api/sac/students/route";
import { type AuditLogDoc, auditCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";

const EXEC = { uid: "exadm-exec", name: "Erin Exec" };
const MEMBER = { uid: "exadm-member", name: "Morgan Member" };

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
  suspended?: boolean;
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

function post(
  path: string,
  actor: string | null,
  body: unknown,
  opts: { idempotencyKey?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function get(path: string, actor: string | null): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}${path}`, { method: "GET", headers });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function auditsFor(targetId: string): Promise<AuditLogDoc[]> {
  return (await auditCol().where("targetId", "==", targetId).get()).docs.map((d) => d.data());
}

let studentSeq = 0;
async function freshStudent(
  overrides: {
    balanceCents?: number;
    points?: number;
    suspended?: boolean;
    roles?: { sacMember: boolean; sacExec: boolean };
  } = {},
): Promise<{ uid: string; studentNumber: string; paymentCode: string }> {
  studentSeq += 1;
  const uid = `exadm-student-${studentSeq}`;
  const studentNumber = `8100${studentSeq.toString().padStart(2, "0")}`;
  const paymentCode = `fp1-EXADM${studentSeq.toString().padStart(3, "0")}`;
  await makeUser({
    uid,
    displayName: `Student ${studentSeq}`,
    studentNumber,
    paymentCode,
    ...overrides,
  });
  return { uid, studentNumber, paymentCode };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    paymentCode: "fp1-EXADMEXC",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    paymentCode: "fp1-EXADMMEM",
    roles: { sacMember: true, sacExec: false },
  });
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "idempotency", "rateLimits", "auditLog"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  vi.restoreAllMocks();
});

describe("POST /api/exec/payment-code", () => {
  it("regenerates the code, invalidates the old one for lookup, and audits", async () => {
    const student = await freshStudent();
    const oldCode = student.paymentCode;

    const res = await regenRoute(
      post("/api/exec/payment-code", EXEC.uid, { studentUid: student.uid }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { studentUid: string }).toEqual({ studentUid: student.uid });

    const user = (await usersCol().doc(student.uid).get()).data();
    expect(user?.paymentCode).not.toBe(oldCode);
    expect(user?.paymentCode.startsWith("fp1-")).toBe(true);

    const oldLookup = await lookupRoute(
      post("/api/sac/lookup", MEMBER.uid, { buyer: { paymentCode: oldCode } }),
    );
    expect(oldLookup.status).toBe(404);
    expect(await errorCode(oldLookup)).toBe("NOT_FOUND");

    const newLookup = await lookupRoute(
      post("/api/sac/lookup", MEMBER.uid, { buyer: { paymentCode: user!.paymentCode } }),
    );
    expect(newLookup.status).toBe(200);

    const audits = await auditsFor(student.uid);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("user.paymentCodeRegen");
    expect(audits[0]!.actorUid).toBe(EXEC.uid);
    expect(audits[0]!.targetType).toBe("user");
  });

  it("returns NOT_FOUND for an unknown student", async () => {
    const res = await regenRoute(post("/api/exec/payment-code", EXEC.uid, { studentUid: "ghost" }));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("forbids a non-exec member and requires auth", async () => {
    const student = await freshStudent();
    const forbidden = await regenRoute(
      post("/api/exec/payment-code", MEMBER.uid, { studentUid: student.uid }),
    );
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("FORBIDDEN");

    const anon = await regenRoute(
      post("/api/exec/payment-code", null, { studentUid: student.uid }),
    );
    expect(anon.status).toBe(401);
    expect(await errorCode(anon)).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/exec/suspend", () => {
  it("suspends an account, blocking top-up and lookup instantly, then unsuspends", async () => {
    const student = await freshStudent({ balanceCents: 0 });

    const suspend = await suspendRoute(
      post("/api/exec/suspend", EXEC.uid, { studentUid: student.uid, suspended: true }),
    );
    expect(suspend.status).toBe(200);
    expect((await usersCol().doc(student.uid).get()).data()?.suspended).toBe(true);

    const blockedTopup = await topupRoute(
      post(
        "/api/sac/topup",
        EXEC.uid,
        { buyer: { studentNumber: student.studentNumber }, amountCents: 500, method: "cash" },
        { idempotencyKey: nextKey() },
      ),
    );
    expect(blockedTopup.status).toBe(403);
    expect(await errorCode(blockedTopup)).toBe("SUSPENDED");

    const blockedLookup = await lookupRoute(
      post("/api/sac/lookup", MEMBER.uid, { buyer: { studentNumber: student.studentNumber } }),
    );
    expect(blockedLookup.status).toBe(403);
    expect(await errorCode(blockedLookup)).toBe("SUSPENDED");

    const unsuspend = await suspendRoute(
      post("/api/exec/suspend", EXEC.uid, { studentUid: student.uid, suspended: false }),
    );
    expect(unsuspend.status).toBe(200);

    const okTopup = await topupRoute(
      post(
        "/api/sac/topup",
        EXEC.uid,
        { buyer: { studentNumber: student.studentNumber }, amountCents: 500, method: "cash" },
        { idempotencyKey: nextKey() },
      ),
    );
    expect(okTopup.status).toBe(200);

    const actions = (await auditsFor(student.uid)).map((a) => a.action).sort();
    expect(actions).toEqual(["user.suspend", "user.unsuspend"]);
  });

  it("returns CONFLICT when the account is already in the requested state", async () => {
    const student = await freshStudent({ suspended: true });
    const res = await suspendRoute(
      post("/api/exec/suspend", EXEC.uid, { studentUid: student.uid, suspended: true }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
  });

  it("forbids a non-exec member and requires auth", async () => {
    const student = await freshStudent();
    const forbidden = await suspendRoute(
      post("/api/exec/suspend", MEMBER.uid, { studentUid: student.uid, suspended: true }),
    );
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("FORBIDDEN");
    expect((await usersCol().doc(student.uid).get()).data()?.suspended).toBe(false);

    const anon = await suspendRoute(
      post("/api/exec/suspend", null, { studentUid: student.uid, suspended: true }),
    );
    expect(anon.status).toBe(401);
    expect(await errorCode(anon)).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/exec/roles", () => {
  it("grants SAC member and reflects it on the target's next request", async () => {
    const student = await freshStudent();
    cookies[student.uid] = await mintSessionCookie(student.uid);

    const before = await studentsRoute(get("/api/sac/students?q=Student", student.uid));
    expect(before.status).toBe(403);

    const grant = await rolesRoute(
      post("/api/exec/roles", EXEC.uid, {
        targetUid: student.uid,
        role: "sacMember",
        grant: true,
      }),
    );
    expect(grant.status).toBe(200);
    expect((await usersCol().doc(student.uid).get()).data()?.roles.sacMember).toBe(true);

    const after = await studentsRoute(get("/api/sac/students?q=Student", student.uid));
    expect(after.status).toBe(200);

    const audits = await auditsFor(student.uid);
    expect(audits.some((a) => a.action === "user.roleGrant")).toBe(true);
  });

  it("revokes a role and audits it", async () => {
    const student = await freshStudent({ roles: { sacMember: true, sacExec: false } });
    const res = await rolesRoute(
      post("/api/exec/roles", EXEC.uid, {
        targetUid: student.uid,
        role: "sacMember",
        grant: false,
      }),
    );
    expect(res.status).toBe(200);
    expect((await usersCol().doc(student.uid).get()).data()?.roles.sacMember).toBe(false);
    expect((await auditsFor(student.uid)).some((a) => a.action === "user.roleRevoke")).toBe(true);
  });

  it("returns CONFLICT when the role is already in the requested state", async () => {
    const student = await freshStudent({ roles: { sacMember: true, sacExec: false } });
    const res = await rolesRoute(
      post("/api/exec/roles", EXEC.uid, { targetUid: student.uid, role: "sacMember", grant: true }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
  });

  it("grants then revokes SAC exec on a student", async () => {
    const student = await freshStudent();

    const grant = await rolesRoute(
      post("/api/exec/roles", EXEC.uid, { targetUid: student.uid, role: "sacExec", grant: true }),
    );
    expect(grant.status).toBe(200);
    expect((await usersCol().doc(student.uid).get()).data()?.roles.sacExec).toBe(true);

    const revoke = await rolesRoute(
      post("/api/exec/roles", EXEC.uid, { targetUid: student.uid, role: "sacExec", grant: false }),
    );
    expect(revoke.status).toBe(200);
    expect((await usersCol().doc(student.uid).get()).data()?.roles.sacExec).toBe(false);
  });

  it("blocks revoking the last SAC exec — the lockout guard", async () => {
    const res = await rolesRoute(
      post("/api/exec/roles", EXEC.uid, { targetUid: EXEC.uid, role: "sacExec", grant: false }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
    expect((await usersCol().doc(EXEC.uid).get()).data()?.roles.sacExec).toBe(true);
  });

  it("allows an exec to revoke their own exec when another exec exists", async () => {
    const student = await freshStudent();
    await rolesRoute(
      post("/api/exec/roles", EXEC.uid, { targetUid: student.uid, role: "sacExec", grant: true }),
    );
    cookies[student.uid] = await mintSessionCookie(student.uid);

    const res = await rolesRoute(
      post("/api/exec/roles", student.uid, {
        targetUid: student.uid,
        role: "sacExec",
        grant: false,
      }),
    );
    expect(res.status).toBe(200);
    expect((await usersCol().doc(student.uid).get()).data()?.roles.sacExec).toBe(false);
    expect((await usersCol().doc(EXEC.uid).get()).data()?.roles.sacExec).toBe(true);
  });

  it("forbids a non-exec member and requires auth", async () => {
    const student = await freshStudent();
    const forbidden = await rolesRoute(
      post("/api/exec/roles", MEMBER.uid, {
        targetUid: student.uid,
        role: "sacMember",
        grant: true,
      }),
    );
    expect(forbidden.status).toBe(403);
    expect(await errorCode(forbidden)).toBe("FORBIDDEN");

    const anon = await rolesRoute(
      post("/api/exec/roles", null, { targetUid: student.uid, role: "sacMember", grant: true }),
    );
    expect(anon.status).toBe(401);
    expect(await errorCode(anon)).toBe("UNAUTHORIZED");
  });
});
