import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as itemsRoute } from "../../src/app/api/exec/booths/[id]/items/route";
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
import type { BoothItem, ChargeResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const EXEC = { uid: "items-exec", name: "Erin Exec" };
const MEMBER = { uid: "items-member", name: "Morgan Member" };
const OPERATOR = { uid: "items-operator", name: "Opal Operator" };

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "tea", name: "Tea", priceCents: 200, isCustom: false },
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
async function makeApprovedBooth(): Promise<string> {
  boothSeq += 1;
  const id = `items-booth-${boothSeq}`;
  await boothsCol()
    .doc(id)
    .set({
      name: "Taco Stand",
      nameLower: "taco stand",
      description: "test booth",
      status: "approved",
      items: ITEMS.map((i) => ({ ...i })),
      joinCode: "TACO-XYZ",
      submitterUid: EXEC.uid,
      submitterEmail: `${EXEC.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
      approvedAt: Timestamp.now(),
      approvedByUid: EXEC.uid,
    });
  return id;
}

function post(actor: string | null, id: string, body: unknown = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/exec/booths/${id}/items`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function route(id: string, request: Request): Promise<Response> {
  return itemsRoute(request, { params: Promise.resolve({ id }) });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function boothDoc(id: string): Promise<BoothDoc> {
  return (await boothsCol().doc(id).get()).data()!;
}

async function itemsAudits(id: string): Promise<AuditLogDoc[]> {
  return (await auditCol().where("targetId", "==", id).get()).docs.map((d) => d.data());
}

let chargeSeq = 0;
async function charge(boothId: string, itemId: string): Promise<Response> {
  chargeSeq += 1;
  const req = new Request(`${ORIGIN}/api/booth/charge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[OPERATOR.uid]}`,
      "idempotency-key": `f47ac10b-58cc-4372-a567-0000000${String(90000 + chargeSeq)}`,
    },
    body: JSON.stringify({
      boothId,
      buyer: { paymentCode: "fp1-BUYER" },
      items: [{ itemId, qty: 1 }],
    }),
  });
  return chargeRoute(req);
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    paymentCode: "fp1-EXEC",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    paymentCode: "fp1-MEMBER",
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({ uid: OPERATOR.uid, displayName: OPERATOR.name, paymentCode: "fp1-OPER" });
  await makeUser({
    uid: "items-buyer",
    displayName: "Bea Buyer",
    paymentCode: "fp1-BUYER",
    balanceCents: 100000,
  });
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[OPERATOR.uid] = await mintSessionCookie(OPERATOR.uid);
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

describe("POST /api/exec/booths/[id]/items", () => {
  it("edits a non-custom price and records the before/after diff", async () => {
    const id = await makeApprovedBooth();
    const res = await route(
      id,
      post(EXEC.uid, id, { priceEdits: [{ id: "coffee", priceCents: 300 }] }),
    );
    expect(res.status).toBe(200);

    const booth = await boothDoc(id);
    expect(booth.items.find((i) => i.id === "coffee")?.priceCents).toBe(300);
    expect(booth.items.find((i) => i.id === "tea")?.priceCents).toBe(200);

    const audits = await itemsAudits(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("booth.priceEdit");
    expect(audits[0]!.actorUid).toBe(EXEC.uid);
    expect(audits[0]!.targetType).toBe("booth");
    expect(audits[0]!.targetLabel).toBe("Taco Stand");
    expect(audits[0]!.details.diff).toEqual([
      { id: "coffee", name: "Coffee", before: 250, after: 300 },
    ]);
  });

  it("prices the next charge from the edited booth doc (I11)", async () => {
    const id = await makeApprovedBooth();
    await membersCol(id)
      .doc(OPERATOR.uid)
      .set({ uid: OPERATOR.uid, displayName: OPERATOR.name, joinedAt: Timestamp.now() });

    const before = await charge(id, "coffee");
    expect(before.status).toBe(200);
    expect(((await before.json()) as ChargeResult).amountCents).toBe(250);

    const edit = await route(
      id,
      post(EXEC.uid, id, { priceEdits: [{ id: "coffee", priceCents: 500 }] }),
    );
    expect(edit.status).toBe(200);

    const after = await charge(id, "coffee");
    expect(after.status).toBe(200);
    expect(((await after.json()) as ChargeResult).amountCents).toBe(500);
  });

  it("rejects a price edit targeting the locked custom item", async () => {
    const id = await makeApprovedBooth();
    const res = await route(
      id,
      post(EXEC.uid, id, { priceEdits: [{ id: "custom", priceCents: 100 }] }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect((await boothDoc(id)).items.find((i) => i.id === "custom")?.priceCents).toBe(50);
    expect(await itemsAudits(id)).toHaveLength(0);
  });

  it("rejects a price edit for an unknown item", async () => {
    const id = await makeApprovedBooth();
    const res = await route(
      id,
      post(EXEC.uid, id, { priceEdits: [{ id: "ghost", priceCents: 100 }] }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect(await itemsAudits(id)).toHaveLength(0);
  });

  it("rejects a price that is not a multiple of $0.50", async () => {
    const id = await makeApprovedBooth();
    const res = await route(
      id,
      post(EXEC.uid, id, { priceEdits: [{ id: "coffee", priceCents: 249 }] }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect((await boothDoc(id)).items.find((i) => i.id === "coffee")?.priceCents).toBe(250);
  });

  it("rejects an empty edit list", async () => {
    const id = await makeApprovedBooth();
    const res = await route(id, post(EXEC.uid, id, { priceEdits: [] }));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("returns NOT_FOUND for a booth that does not exist", async () => {
    const res = await route(
      "no-such-booth",
      post(EXEC.uid, "no-such-booth", { priceEdits: [{ id: "coffee", priceCents: 300 }] }),
    );
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });

  it("forbids a SAC member who is not an exec", async () => {
    const id = await makeApprovedBooth();
    const res = await route(
      id,
      post(MEMBER.uid, id, { priceEdits: [{ id: "coffee", priceCents: 300 }] }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect((await boothDoc(id)).items.find((i) => i.id === "coffee")?.priceCents).toBe(250);
  });

  it("requires authentication", async () => {
    const id = await makeApprovedBooth();
    const res = await route(
      id,
      post(null, id, { priceEdits: [{ id: "coffee", priceCents: 300 }] }),
    );
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });
});
