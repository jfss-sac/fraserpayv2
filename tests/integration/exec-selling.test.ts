import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as catalogRoute } from "../../src/app/api/booth/[id]/catalog/route";
import { GET as historyRoute } from "../../src/app/api/booth/[id]/history/route";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import { POST as lookupRoute } from "../../src/app/api/booth/lookup/route";
import {
  type AuditLogDoc,
  auditCol,
  boothsCol,
  ledgerCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem, ChargeResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const EXEC = { uid: "exec-selling-exec", name: "Xena Exec" };
const MEMBER = { uid: "exec-selling-member", name: "Mira Member" };
const SAC = { uid: "exec-selling-sac", name: "Sam Sac" };
const STUDENT = { uid: "exec-selling-student", name: "Sid Student" };

const BOOTH_ID = "exec-selling-booth";
const PENDING_BOOTH_ID = "exec-selling-booth-pending";
const DEACTIVATED_BOOTH_ID = "exec-selling-booth-deactivated";

const ITEMS: BoothItem[] = [
  { id: "taco", name: "Taco", priceCents: 300, isCustom: false },
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
  roles?: { sacMember: boolean; sacExec: boolean };
  balanceCents?: number;
}): Promise<void> {
  await usersCol()
    .doc(args.uid)
    .set({
      email: `${args.uid}@pdsb.net`,
      displayName: args.displayName,
      displayNameLower: args.displayName.toLowerCase(),
      studentNumber: null,
      paymentCode: `fp1-${args.uid}`,
      balanceCents: args.balanceCents ?? 0,
      points: 0,
      roles: args.roles ?? { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function makeBooth(
  id: string,
  status: "pending" | "approved" | "deactivated",
): Promise<void> {
  await boothsCol()
    .doc(id)
    .set({
      name: `Booth ${id}`,
      nameLower: `booth ${id}`,
      description: "test booth",
      status,
      items: ITEMS,
      joinCode: status === "approved" ? "EXEC-8S5T2" : null,
      submitterUid: MEMBER.uid,
      submitterEmail: `${MEMBER.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
}

let uuidCounter = 0;
function nextKey(): string {
  uuidCounter += 1;
  return `f47ac10b-58cc-4372-a567-${uuidCounter.toString(16).padStart(12, "0")}`;
}

function post(path: string, actor: string, body: unknown, key?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}`,
  };
  if (path === "/api/booth/charge") headers["idempotency-key"] = key ?? nextKey();
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function get(path: string, actor: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "GET",
    headers: { origin: ORIGIN, cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}` },
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

let buyerSeq = 0;
async function freshBuyer(balanceCents: number): Promise<{ uid: string; paymentCode: string }> {
  buyerSeq += 1;
  const uid = `exec-selling-buyer-${buyerSeq}`;
  await makeUser({ uid, displayName: `Buyer ${buyerSeq}`, balanceCents });
  return { uid, paymentCode: `fp1-${uid}` };
}

function chargeBody(boothId: string, paymentCode: string, qty = 1): unknown {
  return { boothId, buyer: { paymentCode }, items: [{ itemId: "taco", qty }] };
}

async function execChargeAudits(): Promise<AuditLogDoc[]> {
  const snap = await auditCol().where("action", "==", "booth.execCharge").get();
  return snap.docs.map((d) => d.data());
}

async function ledgerFor(uid: string): Promise<FirebaseFirestore.DocumentData[]> {
  return (await ledgerCol().where("studentUid", "==", uid).get()).docs.map((d) => d.data());
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({ uid: MEMBER.uid, displayName: MEMBER.name });
  await makeUser({
    uid: SAC.uid,
    displayName: SAC.name,
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({ uid: STUDENT.uid, displayName: STUDENT.name });

  for (const uid of [EXEC.uid, MEMBER.uid, SAC.uid, STUDENT.uid]) {
    cookies[uid] = await mintSessionCookie(uid);
  }

  await makeBooth(BOOTH_ID, "approved");
  await makeBooth(PENDING_BOOTH_ID, "pending");
  await makeBooth(DEACTIVATED_BOOTH_ID, "deactivated");

  await membersCol(BOOTH_ID)
    .doc(MEMBER.uid)
    .set({ uid: MEMBER.uid, displayName: MEMBER.name, joinedAt: Timestamp.now() });
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

describe("exec selling for a booth they never joined (P11 decision 2)", () => {
  it("commits the sale, attributes it to the exec, and audits it exactly once", async () => {
    const buyer = await freshBuyer(2000);
    const before = (await execChargeAudits()).length;

    const res = await chargeRoute(
      post("/api/booth/charge", EXEC.uid, chargeBody(BOOTH_ID, buyer.paymentCode, 2)),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChargeResult;
    expect(body.amountCents).toBe(600);

    expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(1400);
    const entries = await ledgerFor(buyer.uid);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUid: EXEC.uid,
      actorName: EXEC.name,
      boothId: BOOTH_ID,
    });

    const audits = await execChargeAudits();
    expect(audits).toHaveLength(before + 1);
    expect(audits.at(-1)).toMatchObject({
      action: "booth.execCharge",
      actorUid: EXEC.uid,
      actorName: EXEC.name,
      targetType: "booth",
      targetId: BOOTH_ID,
      targetLabel: `Booth ${BOOTH_ID}`,
      details: { entryId: body.entryId, amountCents: 600 },
    });
  });

  it("writes no exec-charge audit row for the booth's own member", async () => {
    const buyer = await freshBuyer(2000);
    const before = (await execChargeAudits()).length;

    const res = await chargeRoute(
      post("/api/booth/charge", MEMBER.uid, chargeBody(BOOTH_ID, buyer.paymentCode)),
    );
    expect(res.status).toBe(200);
    expect((await execChargeAudits()).length).toBe(before);
  });

  it("audits the exec's sale once even when the charge is replayed", async () => {
    const buyer = await freshBuyer(2000);
    const before = (await execChargeAudits()).length;
    const key = nextKey();
    const body = chargeBody(BOOTH_ID, buyer.paymentCode);

    const first = await chargeRoute(post("/api/booth/charge", EXEC.uid, body, key));
    const replay = await chargeRoute(post("/api/booth/charge", EXEC.uid, body, key));
    expect(first.status).toBe(200);
    expect(replay.headers.get("idempotent-replay")).toBe("true");

    expect(await ledgerFor(buyer.uid)).toHaveLength(1);
    expect((await execChargeAudits()).length).toBe(before + 1);
  });

  it("refuses a SAC member who is not an exec", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post("/api/booth/charge", SAC.uid, chargeBody(BOOTH_ID, buyer.paymentCode)),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it("refuses a plain student", async () => {
    const buyer = await freshBuyer(2000);
    const res = await chargeRoute(
      post("/api/booth/charge", STUDENT.uid, chargeBody(BOOTH_ID, buyer.paymentCode)),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect(await ledgerFor(buyer.uid)).toHaveLength(0);
  });

  it.each([PENDING_BOOTH_ID, DEACTIVATED_BOOTH_ID])(
    "refuses the exec at %s — operator rights follow an approved booth",
    async (boothId) => {
      const buyer = await freshBuyer(2000);
      const before = (await execChargeAudits()).length;

      const res = await chargeRoute(
        post("/api/booth/charge", EXEC.uid, chargeBody(boothId, buyer.paymentCode)),
      );
      expect(res.status).toBe(409);
      expect(await errorCode(res)).toBe("BOOTH_NOT_SELLABLE");
      expect(await ledgerFor(buyer.uid)).toHaveLength(0);
      expect((await usersCol().doc(buyer.uid).get()).data()?.balanceCents).toBe(2000);
      expect((await execChargeAudits()).length).toBe(before);
    },
  );
});

describe("the endpoints a stand-in POS needs", () => {
  it("lets the exec read the catalog of the approved booth", async () => {
    const res = await catalogRoute(get(`/api/booth/${BOOTH_ID}/catalog`, EXEC.uid), {
      params: Promise.resolve({ id: BOOTH_ID }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toMatchObject({ id: BOOTH_ID });
  });

  it("refuses the exec the catalog of a booth that cannot sell", async () => {
    const res = await catalogRoute(get(`/api/booth/${PENDING_BOOTH_ID}/catalog`, EXEC.uid), {
      params: Promise.resolve({ id: PENDING_BOOTH_ID }),
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("BOOTH_NOT_SELLABLE");
  });

  it("still serves that pending catalog to the booth's own member", async () => {
    await membersCol(PENDING_BOOTH_ID)
      .doc(MEMBER.uid)
      .set({ uid: MEMBER.uid, displayName: MEMBER.name, joinedAt: Timestamp.now() });
    const res = await catalogRoute(get(`/api/booth/${PENDING_BOOTH_ID}/catalog`, MEMBER.uid), {
      params: Promise.resolve({ id: PENDING_BOOTH_ID }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { status: string }).toMatchObject({ status: "pending" });
  });

  it("lets the exec look a buyer up at the booth they are standing in for", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post("/api/booth/lookup", EXEC.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { balanceCents: number }).toMatchObject({ balanceCents: 2000 });
  });

  it("refuses the lookup to a plain student", async () => {
    const buyer = await freshBuyer(2000);
    const res = await lookupRoute(
      post("/api/booth/lookup", STUDENT.uid, {
        boothId: BOOTH_ID,
        buyer: { paymentCode: buyer.paymentCode },
      }),
    );
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });
});

describe("the booth's own history stays member-only (P11 decision 8)", () => {
  it("refuses the non-member exec", async () => {
    const res = await historyRoute(get(`/api/booth/${BOOTH_ID}/history`, EXEC.uid), {
      params: Promise.resolve({ id: BOOTH_ID }),
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("serves the booth's own member", async () => {
    const res = await historyRoute(get(`/api/booth/${BOOTH_ID}/history`, MEMBER.uid), {
      params: Promise.resolve({ id: BOOTH_ID }),
    });
    expect(res.status).toBe(200);
  });
});
