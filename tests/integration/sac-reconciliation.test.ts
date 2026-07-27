import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as reconRoute } from "../../src/app/api/sac/reconciliation/route";
import { type LedgerEntryDoc, ledgerCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { torontoDate } from "../../src/lib/server/money/shared";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { ReconciliationDTO } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";
const DATE = "2024-01-15";

const MEMBER = { uid: "recon-member", name: "Ava Member" };
const MEMBER2 = { uid: "recon-member-2", name: "Ben Member" };
const EXEC = { uid: "recon-exec", name: "Xander Exec" };
const STUDENT = { uid: "recon-student", name: "Stu Dent" };

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

async function makeUser(
  uid: string,
  displayName: string,
  roles: { sacMember: boolean; sacExec: boolean },
): Promise<void> {
  await usersCol()
    .doc(uid)
    .set({
      email: `${uid}@pdsb.net`,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      studentNumber: null,
      paymentCode: `fp1-${uid}`,
      balanceCents: 0,
      points: 0,
      roles,
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

let seq = 0;
const BASE_MS = Date.parse("2024-01-15T15:00:00Z");

async function seedEntry(
  overrides: Partial<LedgerEntryDoc> & { atMs?: number } = {},
): Promise<string> {
  seq += 1;
  const { atMs, ...rest } = overrides;
  const entry: LedgerEntryDoc = {
    type: "topup",
    amountCents: 1000,
    direction: "credit",
    balanceAfterCents: 1000,
    studentUid: "some-student",
    studentNumber: "700001",
    studentName: "Seed Student",
    actorUid: MEMBER.uid,
    actorName: MEMBER.name,
    tags: [],
    idempotencyKey: `recon-seed-${seq}`,
    createdAt: Timestamp.fromMillis(atMs ?? BASE_MS + seq * 1000),
    createdDate: DATE,
    method: "cash",
    ...rest,
  };
  const ref = ledgerCol().doc();
  await ref.set(entry);
  return ref.id;
}

function reconReq(actor: string | null, query = ""): Request {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/sac/reconciliation${query}`, { method: "GET", headers });
}

async function getBody(actor: string, query: string): Promise<ReconciliationDTO> {
  return (await (await reconRoute(reconReq(actor, query))).json()) as ReconciliationDTO;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser(MEMBER.uid, MEMBER.name, { sacMember: true, sacExec: false });
  await makeUser(MEMBER2.uid, MEMBER2.name, { sacMember: true, sacExec: false });
  await makeUser(EXEC.uid, EXEC.name, { sacMember: true, sacExec: true });
  await makeUser(STUDENT.uid, STUDENT.name, { sacMember: false, sacExec: false });

  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[MEMBER2.uid] = await mintSessionCookie(MEMBER2.uid);
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[STUDENT.uid] = await mintSessionCookie(STUDENT.uid);
});

beforeEach(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["ledger", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))),
  );
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))),
  );
  vi.restoreAllMocks();
});

describe("GET /api/sac/reconciliation — access & validation", () => {
  it("lets a SAC member read with no-store", async () => {
    const res = await reconRoute(reconReq(MEMBER.uid, `?date=${DATE}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as ReconciliationDTO;
    expect(body).toEqual({
      date: DATE,
      members: [],
      totals: { cashCents: 0, cardCents: 0, topupCount: 0, correctionCount: 0 },
    });
  });

  it("lets an exec read", async () => {
    const res = await reconRoute(reconReq(EXEC.uid, `?date=${DATE}`));
    expect(res.status).toBe(200);
  });

  it("forbids a non-SAC student", async () => {
    const res = await reconRoute(reconReq(STUDENT.uid, `?date=${DATE}`));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await reconRoute(reconReq(null, `?date=${DATE}`));
    expect(res.status).toBe(401);
  });

  it("rejects a missing or malformed date", async () => {
    expect((await reconRoute(reconReq(MEMBER.uid))).status).toBe(400);
    expect((await reconRoute(reconReq(MEMBER.uid, "?date=2024-1-5"))).status).toBe(400);
  });

  it("rejects unknown query params", async () => {
    const res = await reconRoute(reconReq(MEMBER.uid, `?date=${DATE}&bogus=1`));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });
});

describe("GET /api/sac/reconciliation — method split & recomputation", () => {
  it("groups by actor × method and reconciles with an independent ledger sum", async () => {
    await seedEntry({
      actorUid: MEMBER.uid,
      actorName: MEMBER.name,
      method: "cash",
      amountCents: 500,
    });
    await seedEntry({
      actorUid: MEMBER.uid,
      actorName: MEMBER.name,
      method: "cash",
      amountCents: 1000,
    });
    await seedEntry({
      actorUid: MEMBER.uid,
      actorName: MEMBER.name,
      method: "card",
      amountCents: 2000,
    });
    await seedEntry({
      actorUid: MEMBER2.uid,
      actorName: MEMBER2.name,
      method: "card",
      amountCents: 5000,
    });
    // Noise that must not count: a purchase and a top-up on a different day.
    await seedEntry({ type: "purchase", direction: "debit", amountCents: 300, method: undefined });
    await seedEntry({ createdDate: "2024-01-16", method: "cash", amountCents: 9999 });

    const body = await getBody(MEMBER.uid, `?date=${DATE}`);

    const ava = body.members.find((m) => m.actorUid === MEMBER.uid)!;
    expect(ava.cashCents).toBe(1500);
    expect(ava.cashCount).toBe(2);
    expect(ava.cardCents).toBe(2000);
    expect(ava.cardCount).toBe(1);

    const ben = body.members.find((m) => m.actorUid === MEMBER2.uid)!;
    expect(ben.cardCents).toBe(5000);
    expect(ben.cashCents).toBe(0);

    expect(body.totals).toEqual({
      cashCents: 1500,
      cardCents: 7000,
      topupCount: 4,
      correctionCount: 0,
    });

    // Independent recomputation straight off the ledger for the day.
    const snap = await ledgerCol()
      .where("type", "==", "topup")
      .where("createdDate", "==", DATE)
      .get();
    let cash = 0;
    let card = 0;
    for (const d of snap.docs) {
      const doc = d.data();
      if (doc.method === "card") card += doc.amountCents;
      else cash += doc.amountCents;
    }
    expect(body.totals.cashCents).toBe(cash);
    expect(body.totals.cardCents).toBe(card);
    expect(body.totals.cashCents + body.totals.cardCents).toBe(cash + card);
  });

  it("filters to a single actor when actorUid is supplied", async () => {
    await seedEntry({ actorUid: MEMBER.uid, actorName: MEMBER.name, amountCents: 500 });
    await seedEntry({ actorUid: MEMBER2.uid, actorName: MEMBER2.name, amountCents: 1000 });

    const body = await getBody(MEMBER.uid, `?date=${DATE}&actorUid=${MEMBER2.uid}`);
    expect(body.members.map((m) => m.actorUid)).toEqual([MEMBER2.uid]);
    expect(body.totals.cashCents).toBe(1000);
  });
});

describe("GET /api/sac/reconciliation — Toronto day boundary (A7)", () => {
  it("buckets a top-up by its Toronto calendar day, not UTC", async () => {
    const evening = new Date("2024-01-15T04:59:00Z"); // 23:59 EST on Jan 14
    const morning = new Date("2024-01-15T05:01:00Z"); // 00:01 EST on Jan 15
    expect(torontoDate(evening)).toBe("2024-01-14");
    expect(torontoDate(morning)).toBe("2024-01-15");

    const eve = await seedEntry({
      createdDate: torontoDate(evening),
      atMs: evening.getTime(),
      amountCents: 500,
    });
    const morn = await seedEntry({
      createdDate: torontoDate(morning),
      atMs: morning.getTime(),
      amountCents: 1000,
    });

    const jan14 = await getBody(MEMBER.uid, "?date=2024-01-14");
    expect(jan14.members[0]!.topups.map((t) => t.id)).toEqual([eve]);
    expect(jan14.totals.cashCents).toBe(500);

    const jan15 = await getBody(MEMBER.uid, "?date=2024-01-15");
    expect(jan15.members[0]!.topups.map((t) => t.id)).toEqual([morn]);
    expect(jan15.totals.cashCents).toBe(1000);
  });
});

describe("GET /api/sac/reconciliation — corrections", () => {
  it("lists a linked adjustment as a correction and ignores an unlinked one", async () => {
    await seedEntry({
      actorUid: EXEC.uid,
      actorName: EXEC.name,
      method: "cash",
      amountCents: 1000,
    });
    const linked = await seedEntry({
      type: "adjustment",
      direction: "debit",
      actorUid: EXEC.uid,
      actorName: EXEC.name,
      amountCents: 500,
      reason: "duplicate top-up",
      originalEntryId: "orig-1",
      pointsDelta: -25,
      method: undefined,
    });
    await seedEntry({
      type: "adjustment",
      direction: "credit",
      actorUid: EXEC.uid,
      actorName: EXEC.name,
      amountCents: 250,
      reason: "goodwill credit",
      method: undefined,
    });

    const body = await getBody(MEMBER.uid, `?date=${DATE}`);
    const exec = body.members.find((m) => m.actorUid === EXEC.uid)!;
    expect(exec.corrections.map((c) => c.id)).toEqual([linked]);
    expect(exec.corrections[0]).toMatchObject({
      direction: "debit",
      amountCents: 500,
      reason: "duplicate top-up",
      originalEntryId: "orig-1",
      pointsDelta: -25,
    });
    expect(body.totals.correctionCount).toBe(1);
    // The unlinked adjustment must not inflate the cash/card totals either.
    expect(exec.cashCents).toBe(1000);
  });
});
