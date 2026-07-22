import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as joinRoute } from "../../src/app/api/booths/join/route";
import { authorizeRequest, listMemberBooths } from "../../src/lib/server/dal";
import { boothsCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
];

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
      paymentCode: `fp1-${args.uid}`,
      balanceCents: 0,
      points: 0,
      roles: { sacMember: false, sacExec: false },
      suspended: args.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  cookies[args.uid] = await mintSessionCookie(args.uid);
}

let boothSeq = 0;
async function makeBooth(args: {
  name: string;
  status: "pending" | "approved" | "deactivated";
  joinCode: string | null;
}): Promise<string> {
  boothSeq += 1;
  const id = `join-booth-${boothSeq}`;
  await boothsCol()
    .doc(id)
    .set({
      name: args.name,
      nameLower: args.name.toLowerCase(),
      description: "test booth",
      status: args.status,
      items: ITEMS.map((i) => ({ ...i })),
      joinCode: args.joinCode,
      submitterUid: "seed",
      submitterEmail: "seed@pdsb.net",
      createdAt: Timestamp.now(),
    });
  return id;
}

function joinRequest(actor: string | null, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/booths/join`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "idempotency", "rateLimits", "auditLog"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  await db.recursiveDelete(db.collection("booths"));
  vi.restoreAllMocks();
});

describe("POST /api/booths/join", () => {
  it("joins an approved booth by code and passes the booth-member gate", async () => {
    await makeUser({ uid: "join-ok", displayName: "Jo Ok" });
    const boothId = await makeBooth({
      name: "Taco Stand",
      status: "approved",
      joinCode: "TACO-4F2",
    });

    const res = await joinRoute(joinRequest("join-ok", { code: "TACO-4F2" }));
    expect(res.status).toBe(200);
    expect((await res.json()) as { name: string }).toMatchObject({ boothId, name: "Taco Stand" });

    const member = await membersCol(boothId).doc("join-ok").get();
    expect(member.exists).toBe(true);
    expect(member.data()!.displayName).toBe("Jo Ok");

    const authed = joinRequest("join-ok", { code: "TACO-4F2" });
    await expect(authorizeRequest("boothMember", authed, boothId)).resolves.toMatchObject({
      uid: "join-ok",
    });
  });

  it("normalizes lowercase/whitespace input to the stored code", async () => {
    await makeUser({ uid: "join-norm", displayName: "Nora Norm" });
    const boothId = await makeBooth({ name: "Fries", status: "approved", joinCode: "FRIE-2K7" });

    const res = await joinRoute(joinRequest("join-norm", { code: "  frie-2k7 " }));
    expect(res.status).toBe(200);
    expect((await membersCol(boothId).doc("join-norm").get()).exists).toBe(true);
  });

  it("is idempotent by nature: re-joining preserves the original membership", async () => {
    await makeUser({ uid: "join-rejoin", displayName: "Ray Rejoin" });
    const boothId = await makeBooth({ name: "Nachos", status: "approved", joinCode: "NACH-9P3" });

    expect((await joinRoute(joinRequest("join-rejoin", { code: "NACH-9P3" }))).status).toBe(200);
    const first = (await membersCol(boothId).doc("join-rejoin").get()).data()!.joinedAt;

    expect((await joinRoute(joinRequest("join-rejoin", { code: "NACH-9P3" }))).status).toBe(200);
    const second = (await membersCol(boothId).doc("join-rejoin").get()).data()!.joinedAt;

    expect(second.toMillis()).toBe(first.toMillis());
  });

  it("lets a student belong to multiple booths (A4) and lists them for the sell picker", async () => {
    await makeUser({ uid: "join-multi", displayName: "Mel Multi" });
    const a = await makeBooth({ name: "Zeta Booth", status: "approved", joinCode: "ZETA-111" });
    const b = await makeBooth({ name: "Alpha Booth", status: "approved", joinCode: "ALPH-222" });

    expect((await joinRoute(joinRequest("join-multi", { code: "ZETA-111" }))).status).toBe(200);
    expect((await joinRoute(joinRequest("join-multi", { code: "ALPH-222" }))).status).toBe(200);

    const booths = await listMemberBooths("join-multi");
    expect(booths.map((x) => x.id)).toEqual([b, a]);
    expect(booths.map((x) => x.name)).toEqual(["Alpha Booth", "Zeta Booth"]);
  });

  it("returns a generic NOT_FOUND for a wrong code (no oracle)", async () => {
    await makeUser({ uid: "join-wrong", displayName: "Wes Wrong" });
    await makeBooth({ name: "Real Booth", status: "approved", joinCode: "REAL-777" });

    const res = await joinRoute(joinRequest("join-wrong", { code: "ZZZZ-999" }));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("refuses a pending booth's code with the same generic NOT_FOUND", async () => {
    await makeUser({ uid: "join-pending", displayName: "Pat Pending" });
    const boothId = await makeBooth({
      name: "Soon Booth",
      status: "pending",
      joinCode: "SOON-333",
    });

    const res = await joinRoute(joinRequest("join-pending", { code: "SOON-333" }));
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
    expect((await membersCol(boothId).doc("join-pending").get()).exists).toBe(false);
  });

  it("blocks a suspended user", async () => {
    await makeUser({ uid: "join-susp", displayName: "Sue Susp", suspended: true });
    const boothId = await makeBooth({
      name: "Gate Booth",
      status: "approved",
      joinCode: "GATE-444",
    });

    const res = await joinRoute(joinRequest("join-susp", { code: "GATE-444" }));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("SUSPENDED");
    expect((await membersCol(boothId).doc("join-susp").get()).exists).toBe(false);
  });

  it("requires authentication", async () => {
    await makeBooth({ name: "Auth Booth", status: "approved", joinCode: "AUTH-555" });
    const res = await joinRoute(joinRequest(null, { code: "AUTH-555" }));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("trips the strict join rate limit at the threshold", async () => {
    await makeUser({ uid: "join-rl", displayName: "Rae Limit" });
    await makeBooth({ name: "Limit Booth", status: "approved", joinCode: "LIMI-666" });

    const limit = 10;
    for (let i = 0; i < limit; i += 1) {
      expect((await joinRoute(joinRequest("join-rl", { code: "LIMI-666" }))).status).toBe(200);
    }
    const overflow = await joinRoute(joinRequest("join-rl", { code: "LIMI-666" }));
    expect(overflow.status).toBe(429);
    expect(await errorCode(overflow)).toBe("RATE_LIMITED");
  });
});
