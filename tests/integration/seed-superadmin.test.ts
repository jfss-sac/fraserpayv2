import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/auth/session/route";
import { authorizeRequest } from "../../src/lib/server/dal";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import { seedSuperadmin } from "../../scripts/seed-superadmin";

const ORIGIN = "http://127.0.0.1";

const PRE = { uid: "sa-pre", email: "820001@pdsb.net" };
const POST_ = { uid: "sa-post", email: "820002@pdsb.net" };
const IDEM = { uid: "sa-idem", email: "820003@pdsb.net" };
const authUids: string[] = [];

let ipCounter = 0;

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

async function createAuthUser(uid: string, email: string): Promise<void> {
  authUids.push(uid);
  await getAdminAuth()
    .deleteUser(uid)
    .catch(() => undefined);
  await getAdminAuth().createUser({ uid, email, emailVerified: true });
}

async function signIn(uid: string): Promise<void> {
  ipCounter += 1;
  const res = await POST(
    new Request(`${ORIGIN}/api/auth/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "x-forwarded-for": `198.51.100.${ipCounter}`,
      },
      body: JSON.stringify({ idToken: await mintIdToken(uid) }),
    }),
  );
  expect(res.status).toBe(200);
}

async function sessionCookie(uid: string): Promise<string> {
  return getAdminAuth().createSessionCookie(await mintIdToken(uid), { expiresIn: SESSION_TTL_MS });
}

function execReq(cookie: string): Request {
  return new Request(`${ORIGIN}/api/test`, {
    method: "GET",
    headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
  });
}

async function passesRequireSacExec(uid: string): Promise<boolean> {
  try {
    const session = await authorizeRequest("sacExec", execReq(await sessionCookie(uid)));
    return session?.uid === uid;
  } catch {
    return false;
  }
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Integration test requires the auth + firestore emulators (run via emulators:exec).",
    );
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("users"));
  await db.recursiveDelete(db.collection("pendingRoleGrants"));
  await db.recursiveDelete(db.collection("rateLimits"));
  await getAdminAuth().deleteUsers(authUids);
  vi.restoreAllMocks();
});

describe("seed-superadmin against the emulators", () => {
  it("rejects an empty email", async () => {
    await expect(seedSuperadmin(getAdminFirestore(), "  ")).rejects.toThrow(/email/i);
  });

  it("records a pending grant when the account does not exist yet", async () => {
    const db = getAdminFirestore();
    const result = await seedSuperadmin(db, PRE.email);
    expect(result).toEqual({ email: PRE.email, outcome: "pending", uid: null });

    const pending = (await db.collection("pendingRoleGrants").doc(PRE.email).get()).data();
    expect(pending!.roles).toEqual({ sacMember: true, sacExec: true });
    expect((await db.collection("users").where("email", "==", PRE.email).get()).empty).toBe(true);
  });

  it("applies the pending grant on first sign-in, and the account passes requireSacExec", async () => {
    const db = getAdminFirestore();
    await createAuthUser(PRE.uid, PRE.email);
    await signIn(PRE.uid);

    const user = (await db.collection("users").doc(PRE.uid).get()).data();
    expect(user!.roles).toEqual({ sacMember: true, sacExec: true });
    expect((await db.collection("pendingRoleGrants").doc(PRE.email).get()).exists).toBe(false);

    expect(await passesRequireSacExec(PRE.uid)).toBe(true);
  });

  it("grants directly when the account already exists, and it passes requireSacExec", async () => {
    const db = getAdminFirestore();
    await createAuthUser(POST_.uid, POST_.email);
    await signIn(POST_.uid);

    const before = (await db.collection("users").doc(POST_.uid).get()).data();
    expect(before!.roles).toEqual({ sacMember: false, sacExec: false });
    expect(await passesRequireSacExec(POST_.uid)).toBe(false);

    const result = await seedSuperadmin(db, POST_.email);
    expect(result).toEqual({ email: POST_.email, outcome: "granted", uid: POST_.uid });

    const after = (await db.collection("users").doc(POST_.uid).get()).data();
    expect(after!.roles).toEqual({ sacMember: true, sacExec: true });
    expect(await passesRequireSacExec(POST_.uid)).toBe(true);
  });

  it("is idempotent for an existing account: a second run is a no-op already-exec", async () => {
    const db = getAdminFirestore();
    const again = await seedSuperadmin(db, POST_.email);
    expect(again).toEqual({ email: POST_.email, outcome: "already-exec", uid: POST_.uid });

    const doc = (await db.collection("users").doc(POST_.uid).get()).data();
    expect(doc!.roles).toEqual({ sacMember: true, sacExec: true });
  });

  it("is idempotent for a pending grant: a second run leaves a single pending doc", async () => {
    const db = getAdminFirestore();
    const first = await seedSuperadmin(db, IDEM.email);
    const second = await seedSuperadmin(db, IDEM.email);
    expect(first.outcome).toBe("pending");
    expect(second.outcome).toBe("pending");

    const grants = await db.collection("pendingRoleGrants").where("email", "==", IDEM.email).get();
    expect(grants.size).toBe(1);
  });

  it("normalizes email casing when matching and recording", async () => {
    const db = getAdminFirestore();
    const result = await seedSuperadmin(db, POST_.email.toUpperCase());
    expect(result.outcome).toBe("already-exec");
    expect(result.email).toBe(POST_.email);
  });
});
