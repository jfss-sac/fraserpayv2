import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as createRoute } from "../../src/app/api/exec/booths/route";
import { POST as editPricesRoute } from "../../src/app/api/exec/booths/[id]/items/route";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import { POST as joinRoute } from "../../src/app/api/booths/join/route";
import {
  type AuditLogDoc,
  type BoothDoc,
  auditCol,
  boothsCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { JOIN_CODE_ALPHABET, SUFFIX_LEN } from "../../src/lib/server/boothCode";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const JOIN_CODE_FORMAT = new RegExp(`^[A-Z]{4}-[${JOIN_CODE_ALPHABET}]{${SUFFIX_LEN}}$`);

const EXEC = { uid: "create-exec", name: "Casey Exec" };
const MEMBER = { uid: "create-member", name: "Maya Member" };
const STUDENT = { uid: "create-student", name: "Sam Student" };
const BUYER = { uid: "create-buyer", name: "Bailey Buyer" };

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
  cookies[args.uid] = await mintSessionCookie(args.uid);
}

function request(actor: string | null, endpoint: string, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function createRequest(actor: string | null, body: unknown): Request {
  return request(actor, "/api/exec/booths", body);
}

function joinRequest(actor: string | null, body: unknown): Request {
  return request(actor, "/api/booths/join", body);
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const validBody = () => ({
  name: "Taco Stand",
  description: "Fresh tacos all day",
  items: [
    { name: "Taco", priceCents: 250 },
    { name: "Churro", priceCents: 150 },
  ],
});

async function boothDoc(id: string): Promise<BoothDoc> {
  return (await boothsCol().doc(id).get()).data()!;
}

async function createBooth(): Promise<{ id: string; booth: BoothDoc; joinCode: string }> {
  const res = await createRoute(createRequest(EXEC.uid, validBody()));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { boothId: string; status: string; joinCode: string };
  const booth = await boothDoc(body.boothId);
  return { id: body.boothId, booth, joinCode: body.joinCode };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error(
      "Integration test requires the auth + firestore emulators (run via emulators:exec).",
    );
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({ uid: STUDENT.uid, displayName: STUDENT.name });
  await makeUser({ uid: BUYER.uid, displayName: BUYER.name, balanceCents: 1000 });
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

describe("POST /api/exec/booths", () => {
  it("creates an approved, immediately chargeable booth with a unique join code", async () => {
    const first = await createBooth();
    const second = await createBooth();

    expect(first.joinCode).toMatch(JOIN_CODE_FORMAT);
    expect(second.joinCode).toMatch(JOIN_CODE_FORMAT);
    expect(second.joinCode).not.toBe(first.joinCode);
    expect((await boothsCol().where("joinCode", "==", first.joinCode).get()).size).toBe(1);
    expect(first.booth.status).toBe("approved");
    expect(first.booth.joinCode).toBe(first.joinCode);
    expect(first.booth.approvedByUid).toBe(EXEC.uid);
    expect(first.booth.approvedAt).toBeDefined();
    expect(first.booth.submitterUid).toBe(EXEC.uid);
    expect(first.booth.submitterEmail).toBe(`${EXEC.uid}@pdsb.net`);

    const custom = first.booth.items.find((item) => item.isCustom);
    expect(custom).toEqual({ id: "custom", name: "Custom", priceCents: 50, isCustom: true });

    const memberRes = await joinRoute(joinRequest(STUDENT.uid, { code: first.joinCode }));
    expect(memberRes.status).toBe(200);
    expect((await membersCol(first.id).doc(STUDENT.uid).get()).exists).toBe(true);

    const chargeRes = await chargeRoute(
      new Request(`${ORIGIN}/api/booth/charge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: `${SESSION_COOKIE_NAME}=${cookies[EXEC.uid]}`,
          "idempotency-key": "f47ac10b-58cc-4372-a567-000000001201",
        },
        body: JSON.stringify({
          boothId: first.id,
          buyer: { paymentCode: `fp1-${BUYER.uid}` },
          items: [{ itemId: "custom", qty: 1 }],
        }),
      }),
    );
    expect(chargeRes.status).toBe(200);
    expect(((await chargeRes.json()) as { amountCents: number }).amountCents).toBe(50);
  });

  it("records exactly one booth.create audit attributed to the creating exec", async () => {
    const created = await createBooth();
    const audits = (await auditCol().where("targetId", "==", created.id).get()).docs.map((doc) =>
      doc.data(),
    );

    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject<Partial<AuditLogDoc>>({
      action: "booth.create",
      actorUid: EXEC.uid,
      actorName: EXEC.name,
      targetType: "booth",
      targetId: created.id,
      targetLabel: "Taco Stand",
      details: { joinCode: created.joinCode },
    });
  });

  it("keeps the custom item price locked", async () => {
    const created = await createBooth();
    const res = await editPricesRoute(
      request(EXEC.uid, `/api/exec/booths/${created.id}/items`, {
        priceEdits: [{ id: "custom", priceCents: 100 }],
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect(
      (await boothDoc(created.id)).items.find((item) => item.id === "custom")?.priceCents,
    ).toBe(50);
  });

  it("rejects non-execs, SAC members, and non-50-cent prices", async () => {
    expect((await createRoute(createRequest(STUDENT.uid, validBody()))).status).toBe(403);
    expect((await createRoute(createRequest(MEMBER.uid, validBody()))).status).toBe(403);

    const before = (await boothsCol().get()).size;
    const invalid = await createRoute(
      createRequest(EXEC.uid, {
        ...validBody(),
        items: [{ name: "Odd", priceCents: 49 }],
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await errorCode(invalid)).toBe("VALIDATION");
    expect((await boothsCol().get()).size).toBe(before);
  });
});
