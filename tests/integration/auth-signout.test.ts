import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/auth/signout/route";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const UID = "signout-user-1";
const EMAIL = "900001@pdsb.net";

async function mintSessionCookie(): Promise<string> {
  const customToken = await getAdminAuth().createCustomToken(UID);
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

function signout(cookie?: string): Promise<Response> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (cookie !== undefined) headers.cookie = `${SESSION_COOKIE_NAME}=${cookie}`;
  return POST(new Request(`${ORIGIN}/api/auth/signout`, { method: "POST", headers }));
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Integration test requires the auth + firestore emulators (run via emulators:exec).",
    );
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
  await getAdminAuth()
    .deleteUser(UID)
    .catch(() => undefined);
  await getAdminAuth().createUser({ uid: UID, email: EMAIL, emailVerified: true });
  await getAdminFirestore()
    .collection("users")
    .doc(UID)
    .set({
      email: EMAIL,
      displayName: UID,
      displayNameLower: UID,
      studentNumber: "900001",
      paymentCode: `fp1-${UID}`,
      balanceCents: 0,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: false,
    });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("users"));
  await getAdminAuth()
    .deleteUser(UID)
    .catch(() => undefined);
  vi.restoreAllMocks();
});

describe("POST /api/auth/signout", () => {
  it("requires a session: no cookie is rejected 401", async () => {
    const res = await signout();
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });

  it("clears the cookie, sends Clear-Site-Data, and revokes the session", async () => {
    const cookie = await mintSessionCookie();
    await new Promise((r) => setTimeout(r, 1000));

    const res = await signout(cookie);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toMatch(/Max-Age=0\b/);

    expect(res.headers.get("clear-site-data")).toBe('"cache", "storage"');

    const after = await signout(cookie);
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: { code: string } }).error.code).toBe("UNAUTHORIZED");
  });
});
