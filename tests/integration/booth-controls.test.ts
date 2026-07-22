import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as rotateRoute } from "../../src/app/api/exec/booths/[id]/rotate-code/route";
import { POST as removeRoute } from "../../src/app/api/exec/booths/[id]/members/remove/route";
import { POST as statusRoute } from "../../src/app/api/exec/booths/[id]/status/route";
import { POST as joinRoute } from "../../src/app/api/booths/join/route";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import {
  type AuditLogDoc,
  type BoothDoc,
  auditCol,
  boothsCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const EXEC = { uid: "ctl-exec", name: "Erin Exec" };
const MEMBER = { uid: "ctl-member", name: "Morgan Member" };
const SELLER = { uid: "ctl-seller", name: "Sam Seller" };
const JOINER = { uid: "ctl-joiner", name: "Jo Joiner" };
const BUYER = { uid: "ctl-buyer", name: "Bea Buyer", code: "fp1-CTLBUYER" };

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
];

const cookies: Record<string, string> = {};
let keySeq = 0;

function idemKey(): string {
  keySeq += 1;
  return `f47ac10b-58cc-4372-a567-${keySeq.toString().padStart(12, "0")}`;
}

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
  paymentCode: string;
  balanceCents?: number;
  roles?: { sacMember: boolean; sacExec: boolean };
}): Promise<void> {
  await usersCol()
    .doc(args.uid)
    .set({
      email: `${args.uid}@pdsb.net`,
      displayName: args.displayName,
      displayNameLower: args.displayName.toLowerCase(),
      studentNumber: null,
      paymentCode: args.paymentCode,
      balanceCents: args.balanceCents ?? 0,
      points: 0,
      roles: args.roles ?? { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

let boothSeq = 0;
async function makeBooth(args: {
  status: BoothDoc["status"];
  joinCode: string | null;
}): Promise<string> {
  boothSeq += 1;
  const id = `ctl-booth-${boothSeq}`;
  await boothsCol()
    .doc(id)
    .set({
      name: "Taco Stand",
      nameLower: "taco stand",
      description: "test booth",
      status: args.status,
      items: ITEMS.map((i) => ({ ...i })),
      joinCode: args.joinCode,
      submitterUid: EXEC.uid,
      submitterEmail: `${EXEC.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
  return id;
}

async function addMember(boothId: string, m: { uid: string; name: string }): Promise<void> {
  await membersCol(boothId)
    .doc(m.uid)
    .set({ uid: m.uid, displayName: m.name, joinedAt: Timestamp.now() });
}

function execPost(path: string, actor: string | null, body: unknown = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function withParams(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  req: Request,
): Promise<Response> {
  return handler(req, { params: Promise.resolve({ id }) });
}

function joinReq(actor: string, code: string): Request {
  return new Request(`${ORIGIN}/api/booths/join`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}`,
    },
    body: JSON.stringify({ code }),
  });
}

function chargeReq(actor: string, boothId: string): Request {
  return new Request(`${ORIGIN}/api/booth/charge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}`,
      "idempotency-key": idemKey(),
    },
    body: JSON.stringify({
      boothId,
      buyer: { paymentCode: BUYER.code },
      items: [{ itemId: "coffee", qty: 1 }],
    }),
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function boothDoc(id: string): Promise<BoothDoc> {
  return (await boothsCol().doc(id).get()).data()!;
}

async function auditsFor(id: string): Promise<AuditLogDoc[]> {
  return (await auditCol().where("targetId", "==", id).get()).docs.map((d) => d.data());
}

async function resetBuyerBalance(): Promise<void> {
  await usersCol().doc(BUYER.uid).update({ balanceCents: 100_000 });
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    paymentCode: "fp1-CTLEXEC",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    paymentCode: "fp1-CTLMEM",
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({ uid: SELLER.uid, displayName: SELLER.name, paymentCode: "fp1-CTLSELL" });
  await makeUser({ uid: JOINER.uid, displayName: JOINER.name, paymentCode: "fp1-CTLJOIN" });
  await makeUser({
    uid: BUYER.uid,
    displayName: BUYER.name,
    paymentCode: BUYER.code,
    balanceCents: 100_000,
  });

  for (const uid of [EXEC.uid, MEMBER.uid, SELLER.uid, JOINER.uid]) {
    cookies[uid] = await mintSessionCookie(uid);
  }
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

describe("POST /api/exec/booths/[id]/rotate-code", () => {
  const path = (id: string) => `/api/exec/booths/${id}/rotate-code`;

  it("rotates the join code, killing the old one and activating the new", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-AAA" });

    expect((await joinRoute(joinReq(JOINER.uid, "TACO-AAA"))).status).toBe(200);

    const res = await withParams(rotateRoute, id, execPost(path(id), EXEC.uid));
    expect(res.status).toBe(200);
    const { joinCode } = (await res.json()) as { joinCode: string };
    expect(joinCode).not.toBe("TACO-AAA");
    expect((await boothDoc(id)).joinCode).toBe(joinCode);

    const stale = await joinRoute(joinReq(SELLER.uid, "TACO-AAA"));
    expect(stale.status).toBe(404);
    expect(await errorCode(stale)).toBe("NOT_FOUND");

    expect((await joinRoute(joinReq(SELLER.uid, joinCode))).status).toBe(200);

    const audits = await auditsFor(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("booth.codeRotate");
    expect(audits[0]!.details.previousJoinCode).toBe("TACO-AAA");
    expect(audits[0]!.details.joinCode).toBe(joinCode);
  });

  it("returns CONFLICT for a booth that is not approved", async () => {
    const id = await makeBooth({ status: "pending", joinCode: null });
    const res = await withParams(rotateRoute, id, execPost(path(id), EXEC.uid));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
  });

  it("forbids a non-exec", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-BBB" });
    const res = await withParams(rotateRoute, id, execPost(path(id), MEMBER.uid));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect((await boothDoc(id)).joinCode).toBe("TACO-BBB");
  });

  it("requires authentication", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-CCC" });
    const res = await withParams(rotateRoute, id, execPost(path(id), null));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/exec/booths/[id]/members/remove", () => {
  const path = (id: string) => `/api/exec/booths/${id}/members/remove`;

  it("removes a member, who then instantly fails to charge", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-DDD" });
    await addMember(id, SELLER);
    await resetBuyerBalance();

    expect((await chargeRoute(chargeReq(SELLER.uid, id))).status).toBe(200);

    const res = await withParams(
      removeRoute,
      id,
      execPost(path(id), EXEC.uid, { uid: SELLER.uid }),
    );
    expect(res.status).toBe(200);
    expect((await membersCol(id).doc(SELLER.uid).get()).exists).toBe(false);

    const blocked = await chargeRoute(chargeReq(SELLER.uid, id));
    expect(blocked.status).toBe(403);
    expect(await errorCode(blocked)).toBe("FORBIDDEN");

    const audits = await auditsFor(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("booth.memberRemove");
    expect(audits[0]!.details.uid).toBe(SELLER.uid);
  });

  it("forbids a non-exec", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-EEE" });
    await addMember(id, SELLER);
    const res = await withParams(
      removeRoute,
      id,
      execPost(path(id), MEMBER.uid, { uid: SELLER.uid }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect((await membersCol(id).doc(SELLER.uid).get()).exists).toBe(true);
  });

  it("requires a uid", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-FFF" });
    const res = await withParams(removeRoute, id, execPost(path(id), EXEC.uid, {}));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });
});

describe("POST /api/exec/booths/[id]/status", () => {
  const path = (id: string) => `/api/exec/booths/${id}/status`;

  it("deactivates a booth, blocking charge and join, then reactivates it", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-GGG" });
    await addMember(id, SELLER);
    await resetBuyerBalance();

    const deact = await withParams(
      statusRoute,
      id,
      execPost(path(id), EXEC.uid, { active: false }),
    );
    expect(deact.status).toBe(200);
    expect((await boothDoc(id)).status).toBe("deactivated");

    const charge = await chargeRoute(chargeReq(SELLER.uid, id));
    expect(charge.status).toBe(409);
    expect(await errorCode(charge)).toBe("BOOTH_NOT_SELLABLE");

    const join = await joinRoute(joinReq(JOINER.uid, "TACO-GGG"));
    expect(join.status).toBe(404);
    expect(await errorCode(join)).toBe("NOT_FOUND");

    const react = await withParams(statusRoute, id, execPost(path(id), EXEC.uid, { active: true }));
    expect(react.status).toBe(200);
    expect((await boothDoc(id)).status).toBe("approved");

    expect((await chargeRoute(chargeReq(SELLER.uid, id))).status).toBe(200);

    const audits = await auditsFor(id);
    expect(audits.map((a) => a.action).sort()).toEqual(["booth.deactivate", "booth.reactivate"]);
  });

  it("returns CONFLICT when deactivating a non-approved booth", async () => {
    const id = await makeBooth({ status: "pending", joinCode: null });
    const res = await withParams(statusRoute, id, execPost(path(id), EXEC.uid, { active: false }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
  });

  it("returns CONFLICT when reactivating an already-approved booth", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-HHH" });
    const res = await withParams(statusRoute, id, execPost(path(id), EXEC.uid, { active: true }));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
  });

  it("forbids a non-exec", async () => {
    const id = await makeBooth({ status: "approved", joinCode: "TACO-III" });
    const res = await withParams(
      statusRoute,
      id,
      execPost(path(id), MEMBER.uid, { active: false }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect((await boothDoc(id)).status).toBe("approved");
  });
});
