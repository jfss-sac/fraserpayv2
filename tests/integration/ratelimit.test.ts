import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RateLimitedError } from "../../src/lib/server/errors";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { defineHandler } from "../../src/lib/server/http";
import { RATE_LIMITS, checkRateLimit } from "../../src/lib/server/ratelimit";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const UID = "ratelimit-student";

let sessionCookie: string;

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
  await getAdminAuth().createUser({ uid: UID, email: "810001@pdsb.net", emailVerified: true });
  await getAdminFirestore()
    .collection("users")
    .doc(UID)
    .set({ email: "810001@pdsb.net", displayName: "RL", suspended: false, roles: {} });
  sessionCookie = await mintSessionCookie(UID);
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("rateLimits"));
  await db.recursiveDelete(db.collection("users"));
  await getAdminAuth()
    .deleteUser(UID)
    .catch(() => undefined);
  vi.restoreAllMocks();
});

describe("checkRateLimit against the Firestore emulator", () => {
  it("passes under the limit and 429s once over it", async () => {
    const { limit } = RATE_LIMITS.join;
    for (let i = 0; i < limit; i++) {
      await expect(checkRateLimit("join", "over-limit")).resolves.toBeUndefined();
    }
    await expect(checkRateLimit("join", "over-limit")).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("isolates distinct keys", async () => {
    const { limit } = RATE_LIMITS.join;
    for (let i = 0; i < limit; i++) await checkRateLimit("join", "keyA");
    await expect(checkRateLimit("join", "keyA")).rejects.toBeInstanceOf(RateLimitedError);
    await expect(checkRateLimit("join", "keyB")).resolves.toBeUndefined();
  });

  it("resets when the fixed window rolls over", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const { limit, windowMs } = RATE_LIMITS.join;
      const base = 1_700_000_000_000;
      vi.setSystemTime(base);
      for (let i = 0; i < limit; i++) await checkRateLimit("join", "rollover");
      await expect(checkRateLimit("join", "rollover")).rejects.toBeInstanceOf(RateLimitedError);
      vi.setSystemTime(base + windowMs);
      await expect(checkRateLimit("join", "rollover")).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

const limited = defineHandler({ role: "session", rateLimit: "join" }, async () => ({
  ok: true,
}));

describe("rate limiting through the handler wrapper", () => {
  it("returns 200 under the limit, then a 429 RATE_LIMITED envelope with Retry-After", async () => {
    const { limit } = RATE_LIMITS.join;
    const make = () =>
      new Request(`${ORIGIN}/api/limited`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}`,
        },
      });

    for (let i = 0; i < limit; i++) {
      expect((await limited(make())).status).toBe(200);
    }

    const res = await limited(make());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
  });
});
