import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/auth/session/route";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const PAYMENT_CODE = /^fp1-[0-9A-HJKMNP-TV-Z]{26}$/;

interface Account {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
}

const ACCOUNTS: Account[] = [
  {
    uid: "auth-student-1",
    email: "700123@pdsb.net",
    emailVerified: true,
    displayName: "Test Student",
  },
  { uid: "auth-teacher-1", email: "kwong@pdsb.net", emailVerified: true, displayName: "K Wong" },
  { uid: "auth-outsider-1", email: "someone@gmail.com", emailVerified: true },
  { uid: "auth-unverified-1", email: "700999@pdsb.net", emailVerified: false },
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

const raceUids: string[] = [];

let ipCounter = 0;
function post(idToken: string): Request {
  ipCounter += 1;
  return new Request(`${ORIGIN}/api/auth/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-forwarded-for": `198.51.100.${ipCounter}`,
    },
    body: JSON.stringify({ idToken }),
  });
}

function sessionCookie(res: Response): string | null {
  const raw = res.headers.get("set-cookie");
  if (!raw || !raw.startsWith(`${SESSION_COOKIE_NAME}=`)) return null;
  return raw;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Integration test requires the auth + firestore emulators (run via emulators:exec).",
    );
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const account of ACCOUNTS) {
    await getAdminAuth()
      .deleteUser(account.uid)
      .catch(() => undefined);
    await getAdminAuth().createUser({
      uid: account.uid,
      email: account.email,
      emailVerified: account.emailVerified,
      displayName: account.displayName,
    });
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("users"));
  await db.recursiveDelete(db.collection("rateLimits"));
  await getAdminAuth().deleteUsers([...ACCOUNTS.map((a) => a.uid), ...raceUids]);
  vi.restoreAllMocks();
});

describe("POST /api/auth/session", () => {
  it("provisions a schema-shaped user doc on first sign-in and mints a session cookie", async () => {
    const res = await POST(post(await mintIdToken("auth-student-1")));
    expect(res.status).toBe(200);

    const cookie = sessionCookie(res);
    expect(cookie).toBeTruthy();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=604800\b/);

    const doc = (await getAdminFirestore().collection("users").doc("auth-student-1").get()).data();
    expect(doc).toBeDefined();
    expect(doc!.email).toBe("700123@pdsb.net");
    expect(doc!.studentNumber).toBe("700123");
    expect(doc!.displayNameLower).toBe("test student");
    expect(doc!.balanceCents).toBe(0);
    expect(doc!.points).toBe(0);
    expect(doc!.suspended).toBe(false);
    expect(doc!.roles).toEqual({ sacMember: false, sacExec: false });
    expect(doc!.paymentCode).toMatch(PAYMENT_CODE);
  });

  it("mints a cookie verifiable by verifySessionCookie with revocation checking", async () => {
    const res = await POST(post(await mintIdToken("auth-student-1")));
    const value = sessionCookie(res)!
      .split(";")[0]!
      .slice(SESSION_COOKIE_NAME.length + 1);
    const decoded = await getAdminAuth().verifySessionCookie(value, true);
    expect(decoded.uid).toBe("auth-student-1");
  });

  it("is idempotent: a second sign-in never overwrites balance, points, or the payment code", async () => {
    const db = getAdminFirestore();
    const ref = db.collection("users").doc("auth-student-1");
    await ref.update({ balanceCents: 5000, points: 250 });
    const before = (await ref.get()).data();

    const res = await POST(post(await mintIdToken("auth-student-1")));
    expect(res.status).toBe(200);

    const after = (await ref.get()).data();
    expect(after!.balanceCents).toBe(5000);
    expect(after!.points).toBe(250);
    expect(after!.paymentCode).toBe(before!.paymentCode);
    expect(after!.createdAt).toEqual(before!.createdAt);
  });

  it("derives a null studentNumber for a teacher-pattern local part", async () => {
    const res = await POST(post(await mintIdToken("auth-teacher-1")));
    expect(res.status).toBe(200);
    const doc = (await getAdminFirestore().collection("users").doc("auth-teacher-1").get()).data();
    expect(doc!.studentNumber).toBeNull();
  });

  it("rejects a non-pdsb.net account with 403 and sets no cookie or user doc", async () => {
    const res = await POST(post(await mintIdToken("auth-outsider-1")));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("FORBIDDEN");
    expect(sessionCookie(res)).toBeNull();
    const doc = await getAdminFirestore().collection("users").doc("auth-outsider-1").get();
    expect(doc.exists).toBe(false);
  });

  it("rejects an unverified pdsb.net account with 403 and sets no cookie", async () => {
    const res = await POST(post(await mintIdToken("auth-unverified-1")));
    expect(res.status).toBe(403);
    expect(sessionCookie(res)).toBeNull();
    const doc = await getAdminFirestore().collection("users").doc("auth-unverified-1").get();
    expect(doc.exists).toBe(false);
  });

  it("provisions exactly once under concurrent first sign-ins (looped)", async () => {
    const db = getAdminFirestore();
    for (let round = 0; round < 5; round++) {
      const uid = `auth-race-${round}`;
      raceUids.push(uid);
      await getAdminAuth()
        .deleteUser(uid)
        .catch(() => undefined);
      await getAdminAuth().createUser({
        uid,
        email: `71000${round}@pdsb.net`,
        emailVerified: true,
      });

      const tokens = await Promise.all([
        mintIdToken(uid),
        mintIdToken(uid),
        mintIdToken(uid),
        mintIdToken(uid),
      ]);
      const results = await Promise.all(tokens.map((t) => POST(post(t))));
      for (const res of results) expect(res.status).toBe(200);

      const doc = (await db.collection("users").doc(uid).get()).data();
      expect(doc!.balanceCents).toBe(0);
      expect(doc!.points).toBe(0);
      expect(doc!.paymentCode).toMatch(PAYMENT_CODE);
    }
  }, 30000);

  it("rejects a garbage token with 401 UNAUTHORIZED", async () => {
    const res = await POST(post("not-a-real-token"));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
    expect(sessionCookie(res)).toBeNull();
  });
});
