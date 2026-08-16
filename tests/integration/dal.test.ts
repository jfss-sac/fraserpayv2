import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { authorizeRequest } from "../../src/lib/server/dal";
import { defineHandler } from "../../src/lib/server/http";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const BOOTH_ID = "dal-booth-1";
const PENDING_BOOTH_ID = "dal-booth-pending";

interface Fixture {
  uid: string;
  email: string;
  roles?: { sacMember?: boolean; sacExec?: boolean };
  suspended?: boolean;
  boothMember?: boolean;
}

const FIXTURES: Fixture[] = [
  { uid: "dal-student", email: "800001@pdsb.net" },
  { uid: "dal-suspended", email: "800002@pdsb.net", suspended: true },
  { uid: "dal-member", email: "800003@pdsb.net", roles: { sacMember: true } },
  { uid: "dal-exec", email: "800004@pdsb.net", roles: { sacExec: true } },
  { uid: "dal-boothseller", email: "800005@pdsb.net", boothMember: true },
];

async function mintIdToken(uid: string): Promise<string> {
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
  return body.idToken;
}

async function mintSessionCookie(uid: string): Promise<string> {
  return getAdminAuth().createSessionCookie(await mintIdToken(uid), { expiresIn: SESSION_TTL_MS });
}

function req(method: string, cookie?: string): Request {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie !== undefined) headers.cookie = `${SESSION_COOKIE_NAME}=${cookie}`;
  return new Request(`${ORIGIN}/api/test`, { method, headers });
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const readSession = defineHandler({ role: "session" }, async ({ session }) => ({
  uid: session!.uid,
}));
const readActive = defineHandler({ role: "active" }, async ({ session }) => ({
  uid: session!.uid,
}));
const readMember = defineHandler({ role: "sacMember" }, async ({ session }) => ({
  uid: session!.uid,
}));
const readExec = defineHandler({ role: "sacExec" }, async ({ session }) => ({ uid: session!.uid }));
const mutateSession = defineHandler(
  { role: "session", schema: z.object({}) },
  async ({ session }) => ({
    uid: session!.uid,
  }),
);
const boothHandler = defineHandler<undefined, { boothId: string }>(
  { role: "boothMember" },
  async ({ session }) => ({ uid: session!.uid }),
);
const operatorHandler = defineHandler<undefined, { boothId: string }>(
  { role: "boothOperator" },
  async ({ session }) => ({ uid: session!.uid }),
);
const bodyScopedOperatorHandler = defineHandler(
  { role: "boothOperator", schema: z.object({ boothId: z.string() }) },
  async ({ session }) => ({ uid: session!.uid }),
);
const unscopedOperatorHandler = defineHandler(
  { role: "boothOperator", schema: z.object({}) },
  async ({ session }) => ({ uid: session!.uid }),
);

function boothReq(cookie: string, boothId: string): Promise<Response> {
  return boothHandler(req("GET", cookie), { params: Promise.resolve({ boothId }) });
}

function operatorReq(cookie: string, boothId: string): Promise<Response> {
  return operatorHandler(req("GET", cookie), { params: Promise.resolve({ boothId }) });
}

function operatorBodyReq(cookie: string, body: unknown, unscoped = false): Promise<Response> {
  const request = new Request(`${ORIGIN}/api/test`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
    },
    body: JSON.stringify(body),
  });
  return unscoped ? unscopedOperatorHandler(request) : bodyScopedOperatorHandler(request);
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Integration test requires the auth + firestore emulators (run via emulators:exec).",
    );
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  const db = getAdminFirestore();
  for (const [id, status] of [
    [BOOTH_ID, "approved"],
    [PENDING_BOOTH_ID, "pending"],
  ] as const) {
    await db.collection("booths").doc(id).set({ name: id, status, items: [] });
  }
  for (const f of FIXTURES) {
    await getAdminAuth()
      .deleteUser(f.uid)
      .catch(() => undefined);
    await getAdminAuth().createUser({ uid: f.uid, email: f.email, emailVerified: true });
    await db
      .collection("users")
      .doc(f.uid)
      .set({
        email: f.email,
        displayName: f.uid,
        displayNameLower: f.uid,
        studentNumber: null,
        paymentCode: `fp1-${f.uid}`,
        balanceCents: 0,
        points: 0,
        roles: { sacMember: f.roles?.sacMember ?? false, sacExec: f.roles?.sacExec ?? false },
        suspended: f.suspended ?? false,
      });
    if (f.boothMember) {
      await db
        .collection("booths")
        .doc(BOOTH_ID)
        .collection("members")
        .doc(f.uid)
        .set({ uid: f.uid, displayName: f.uid });
    }
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("users"));
  await db.recursiveDelete(db.collection("booths"));
  await getAdminAuth().deleteUsers(FIXTURES.map((f) => f.uid));
  vi.restoreAllMocks();
});

describe("DAL session resolution", () => {
  it("resolves a valid session cookie into the request session", async () => {
    const res = await readSession(req("GET", await mintSessionCookie("dal-student")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "dal-student" });
  });

  it("rejects a garbage cookie with 401 UNAUTHORIZED", async () => {
    const res = await readSession(req("GET", "not-a-real-cookie"));
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("UNAUTHORIZED");
  });

  it("rejects a missing cookie with 401 UNAUTHORIZED", async () => {
    const res = await readSession(req("GET"));
    expect(res.status).toBe(401);
    expect(await code(res)).toBe("UNAUTHORIZED");
  });
});

describe("DAL suspension (A3)", () => {
  it("lets a suspended user through a role: session handler (wallet read OK)", async () => {
    const res = await readSession(req("GET", await mintSessionCookie("dal-suspended")));
    expect(res.status).toBe(200);
  });

  it("blocks a suspended user on a role: active handler with SUSPENDED", async () => {
    const res = await readActive(req("GET", await mintSessionCookie("dal-suspended")));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("SUSPENDED");
  });
});

describe("DAL role matrix (arch §7)", () => {
  it("a plain student is neither SAC member nor exec", async () => {
    const cookie = await mintSessionCookie("dal-student");
    expect((await readMember(req("GET", cookie))).status).toBe(403);
    expect((await readExec(req("GET", cookie))).status).toBe(403);
  });

  it("a SAC member passes a sacMember handler but not a sacExec one", async () => {
    const cookie = await mintSessionCookie("dal-member");
    expect((await readMember(req("GET", cookie))).status).toBe(200);
    expect((await readExec(req("GET", cookie))).status).toBe(403);
  });

  it("a SAC exec passes both handlers — exec implies member", async () => {
    const cookie = await mintSessionCookie("dal-exec");
    expect((await readMember(req("GET", cookie))).status).toBe(200);
    expect((await readExec(req("GET", cookie))).status).toBe(200);
  });

  it("a suspended member is blocked before the role check", async () => {
    await getAdminFirestore().collection("users").doc("dal-member").update({ suspended: true });
    const res = await readMember(req("GET", await mintSessionCookie("dal-member")));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("SUSPENDED");
    await getAdminFirestore().collection("users").doc("dal-member").update({ suspended: false });
  });
});

describe("DAL booth membership", () => {
  it("admits a member of the booth", async () => {
    const res = await boothReq(await mintSessionCookie("dal-boothseller"), BOOTH_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "dal-boothseller" });
  });

  it("rejects a member of a different booth with FORBIDDEN", async () => {
    const res = await boothReq(await mintSessionCookie("dal-boothseller"), "some-other-booth");
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("FORBIDDEN");
  });

  it("does not let an exec charge a booth they are not a member of", async () => {
    const res = await boothReq(await mintSessionCookie("dal-exec"), BOOTH_ID);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("FORBIDDEN");
  });
});

describe("DAL booth operator (P11 decision 2)", () => {
  it("admits a member of the booth", async () => {
    const res = await operatorReq(await mintSessionCookie("dal-boothseller"), BOOTH_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "dal-boothseller" });
  });

  it("admits an exec who is not a member of the approved booth", async () => {
    const res = await operatorReq(await mintSessionCookie("dal-exec"), BOOTH_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uid: "dal-exec" });
  });

  it("refuses an exec on a booth that is not approved", async () => {
    const res = await operatorReq(await mintSessionCookie("dal-exec"), PENDING_BOOTH_ID);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("BOOTH_NOT_SELLABLE");
  });

  it("refuses an exec on a booth that does not exist", async () => {
    const res = await operatorReq(await mintSessionCookie("dal-exec"), "dal-booth-missing");
    expect(res.status).toBe(409);
    expect(await code(res)).toBe("BOOTH_NOT_SELLABLE");
  });

  it("refuses a SAC member who is not an exec", async () => {
    const res = await operatorReq(await mintSessionCookie("dal-member"), BOOTH_ID);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("FORBIDDEN");
  });

  it("refuses a plain student", async () => {
    const res = await operatorReq(await mintSessionCookie("dal-student"), BOOTH_ID);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("FORBIDDEN");
  });

  it("refuses a suspended exec before it looks at the booth", async () => {
    await getAdminFirestore().collection("users").doc("dal-exec").update({ suspended: true });
    const res = await operatorReq(await mintSessionCookie("dal-exec"), BOOTH_ID);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("SUSPENDED");
    await getAdminFirestore().collection("users").doc("dal-exec").update({ suspended: false });
  });

  it("scopes a body-carried boothId the same way, since charge and lookup have no route id", async () => {
    const cookie = await mintSessionCookie("dal-boothseller");
    expect((await operatorBodyReq(cookie, { boothId: BOOTH_ID })).status).toBe(200);

    const other = await operatorBodyReq(cookie, { boothId: "some-other-booth" });
    expect(other.status).toBe(403);
    expect(await code(other)).toBe("FORBIDDEN");
  });

  it("refuses to run a booth-scoped handler that carries no boothId at all", async () => {
    const cookie = await mintSessionCookie("dal-boothseller");
    const res = await operatorBodyReq(cookie, {}, true);
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("INTERNAL");
  });
});

function mutate(cookie: string): Promise<Response> {
  return mutateSession(
    new Request(`${ORIGIN}/api/test`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
      },
      body: JSON.stringify({}),
    }),
  );
}

describe("DAL revocation on mutations (checkRevoked)", () => {
  it("accepts a live session on a mutation, then rejects it once revoked", async () => {
    const cookie = await mintSessionCookie("dal-boothseller");
    expect((await mutate(cookie)).status).toBe(200);

    await new Promise((r) => setTimeout(r, 1000));
    await getAdminAuth().revokeRefreshTokens("dal-boothseller");

    const after = await mutate(cookie);
    expect(after.status).toBe(401);
    expect(await code(after)).toBe("UNAUTHORIZED");
  });
});

describe("authorizeRequest booth-scoped roles without a boothId", () => {
  it.each(["boothMember", "boothOperator"] as const)(
    "throws InternalError for %s when the route provides no boothId",
    async (role) => {
      const cookie = await mintSessionCookie("dal-boothseller");
      await expect(authorizeRequest(role, req("GET", cookie))).rejects.toMatchObject({
        code: "INTERNAL",
      });
    },
  );
});
