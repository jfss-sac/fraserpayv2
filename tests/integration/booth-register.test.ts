import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as registerRoute } from "../../src/app/api/booths/register/route";
import { type BoothDoc, boothsCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const ENDPOINT = "/api/booths/register";

const SUBMITTER = { uid: "register-submitter", name: "Terry Teacher" };
const SUSPENDED = { uid: "register-suspended", name: "Sam Suspended" };
const RL_USER = { uid: "register-ratelimit", name: "Rita Ratelimit" };

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
  suspended?: boolean;
}): Promise<void> {
  await usersCol()
    .doc(args.uid)
    .set({
      email: `${args.uid}@pdsb.net`,
      displayName: args.displayName,
      displayNameLower: args.displayName.toLowerCase(),
      studentNumber: null,
      paymentCode: `pc-${args.uid}`,
      balanceCents: 0,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: args.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

function post(actor: string | null, body: unknown): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
  };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}${ENDPOINT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function boothsBySubmitter(uid: string): Promise<BoothDoc[]> {
  return (await boothsCol().where("submitterUid", "==", uid).get()).docs.map((d) => d.data());
}

const validBody = () => ({
  name: "Taco Stand",
  description: "Fresh tacos all day",
  items: [
    { name: "Taco", priceCents: 250 },
    { name: "Churro", priceCents: 150 },
  ],
});

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({ uid: SUBMITTER.uid, displayName: SUBMITTER.name });
  await makeUser({ uid: SUSPENDED.uid, displayName: SUSPENDED.name, suspended: true });
  await makeUser({ uid: RL_USER.uid, displayName: RL_USER.name });
  cookies[SUBMITTER.uid] = await mintSessionCookie(SUBMITTER.uid);
  cookies[SUSPENDED.uid] = await mintSessionCookie(SUSPENDED.uid);
  cookies[RL_USER.uid] = await mintSessionCookie(RL_USER.uid);
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(["users", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))));
  await db.recursiveDelete(db.collection("booths"));
  vi.restoreAllMocks();
});

describe("POST /api/booths/register", () => {
  it("creates a pending booth with the locked custom item and submitter identity", async () => {
    const res = await registerRoute(post(SUBMITTER.uid, validBody()));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { boothId: string; status: string };
    expect(body.status).toBe("pending");

    const booth = (await boothsCol().doc(body.boothId).get()).data()!;
    expect(booth.status).toBe("pending");
    expect(booth.joinCode).toBeNull();
    expect(booth.submitterUid).toBe(SUBMITTER.uid);
    expect(booth.submitterEmail).toBe(`${SUBMITTER.uid}@pdsb.net`);
    expect(booth.nameLower).toBe("taco stand");

    const custom = booth.items.filter((i) => i.isCustom);
    expect(custom).toEqual([{ id: "custom", name: "Custom", priceCents: 50, isCustom: true }]);

    const regular = booth.items.filter((i) => !i.isCustom);
    expect(regular.map((i) => ({ name: i.name, priceCents: i.priceCents }))).toEqual([
      { name: "Taco", priceCents: 250 },
      { name: "Churro", priceCents: 150 },
    ]);
    const ids = booth.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(regular.every((i) => i.id !== "custom")).toBe(true);
  });

  it("rejects a price that is not a multiple of $0.50", async () => {
    const before = (await boothsBySubmitter(SUBMITTER.uid)).length;
    const res = await registerRoute(
      post(SUBMITTER.uid, {
        name: "Bad Booth",
        description: "nope",
        items: [{ name: "Odd", priceCents: 49 }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect((await boothsBySubmitter(SUBMITTER.uid)).length).toBe(before);
  });

  it("rejects a payload that tries to smuggle in its own custom item", async () => {
    const res = await registerRoute(
      post(SUBMITTER.uid, {
        name: "Sneaky Booth",
        description: "trying to override custom",
        items: [{ id: "custom", name: "Custom", priceCents: 500, isCustom: true }],
      }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("requires at least one item", async () => {
    const res = await registerRoute(
      post(SUBMITTER.uid, { name: "Empty Booth", description: "no items", items: [] }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("blocks a suspended account", async () => {
    const res = await registerRoute(post(SUSPENDED.uid, validBody()));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("SUSPENDED");
  });

  it("requires authentication", async () => {
    const res = await registerRoute(post(null, validBody()));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("rate limits repeated registrations from one account", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await registerRoute(post(RL_USER.uid, validBody()));
      expect(res.status).not.toBe(429);
    }
    const limited = await registerRoute(post(RL_USER.uid, validBody()));
    expect(limited.status).toBe(429);
    expect(await errorCode(limited)).toBe("RATE_LIMITED");
  });
});
