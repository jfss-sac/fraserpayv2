import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as searchRoute } from "../../src/app/api/sac/students/route";
import { GET as ledgerRoute } from "../../src/app/api/sac/students/[uid]/ledger/route";
import { type LedgerEntryDoc, ledgerCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { RATE_LIMITS } from "../../src/lib/server/ratelimit";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type {
  SacLedgerEntry,
  StudentLedgerDTO,
  StudentSearchDTO,
  StudentSearchResult,
} from "../../src/lib/shared/types";

const RATE_LIMIT_SWEEP_TIMEOUT_MS = 60_000;

const ORIGIN = "http://127.0.0.1";

const MEMBER = { uid: "sac-students-member", name: "Mimi Member" };
const EXEC = { uid: "sac-students-exec", name: "Xavi Exec" };
const STUDENT = { uid: "sac-students-student", name: "Stu Dent" };
const RL = { uid: "sac-students-rl", name: "Rex Ratelimit" };

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
  email?: string;
  studentNumber?: string | null;
  paymentCode?: string;
  balanceCents?: number;
  points?: number;
  roles?: { sacMember: boolean; sacExec: boolean };
  suspended?: boolean;
}): Promise<void> {
  await usersCol()
    .doc(args.uid)
    .set({
      email: args.email ?? `${args.uid}@pdsb.net`,
      displayName: args.displayName,
      displayNameLower: args.displayName.toLowerCase(),
      studentNumber: args.studentNumber ?? null,
      paymentCode: args.paymentCode ?? `fp1-${args.uid}`,
      balanceCents: args.balanceCents ?? 0,
      points: args.points ?? 0,
      roles: args.roles ?? { sacMember: false, sacExec: false },
      suspended: args.suspended ?? false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

let entrySeq = 0;
const BASE_MS = 1_700_000_000_000;
async function seedEntry(
  uid: string,
  overrides: Partial<LedgerEntryDoc> & { atMs?: number } = {},
): Promise<string> {
  entrySeq += 1;
  const { atMs, ...rest } = overrides;
  const entry: LedgerEntryDoc = {
    type: "purchase",
    amountCents: 100,
    direction: "debit",
    balanceAfterCents: 0,
    studentUid: uid,
    studentNumber: "700001",
    studentName: "Seeded Student",
    actorUid: "seed-actor",
    actorName: "Seed Actor",
    tags: [],
    idempotencyKey: `students-seed-${entrySeq}`,
    createdAt: Timestamp.fromMillis(atMs ?? BASE_MS + entrySeq * 1000),
    createdDate: "2023-11-14",
    ...rest,
  };
  const ref = ledgerCol().doc();
  await ref.set(entry);
  return ref.id;
}

function search(actor: string | null, q: string): Request {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/sac/students?q=${encodeURIComponent(q)}`, {
    method: "GET",
    headers,
  });
}

function searchRaw(actor: string, queryString: string): Request {
  return new Request(`${ORIGIN}/api/sac/students${queryString}`, {
    method: "GET",
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookies[actor]}` },
  });
}

function ledgerReq(
  actor: string | null,
  uid: string,
  cursor?: string,
): [Request, { params: Promise<{ uid: string }> }] {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const req = new Request(`${ORIGIN}/api/sac/students/${uid}/ledger${suffix}`, {
    method: "GET",
    headers,
  });
  return [req, { params: Promise.resolve({ uid }) }];
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    studentNumber: "930500",
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    studentNumber: "930501",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: STUDENT.uid,
    displayName: STUDENT.name,
    studentNumber: "930502",
    roles: { sacMember: false, sacExec: false },
  });
  await makeUser({
    uid: RL.uid,
    displayName: RL.name,
    studentNumber: "930503",
    roles: { sacMember: true, sacExec: false },
  });

  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[STUDENT.uid] = await mintSessionCookie(STUDENT.uid);
  cookies[RL.uid] = await mintSessionCookie(RL.uid);
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))),
  );
  vi.restoreAllMocks();
});

describe("GET /api/sac/students (search)", () => {
  it("finds a student by exact student number, including balance", async () => {
    await makeUser({
      uid: "search-num-1",
      displayName: "Number Target",
      studentNumber: "8300001",
      email: "numbertarget@pdsb.net",
      balanceCents: 1550,
      points: 12.5,
    });
    const res = await searchRoute(search(MEMBER.uid, "8300001"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as StudentSearchDTO;
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toEqual<StudentSearchResult>({
      uid: "search-num-1",
      displayName: "Number Target",
      studentNumber: "8300001",
      email: "numbertarget@pdsb.net",
      balanceCents: 1550,
      points: 12.5,
      suspended: false,
    });
  });

  it("finds a student by exact email, case-insensitively", async () => {
    await makeUser({
      uid: "search-email-1",
      displayName: "Email Target",
      studentNumber: "8300002",
      email: "email.target@pdsb.net",
      balanceCents: 400,
    });
    const res = await searchRoute(search(MEMBER.uid, "Email.Target@PDSB.net"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as StudentSearchDTO;
    expect(body.results.map((r) => r.uid)).toEqual(["search-email-1"]);
    expect(body.results[0]!.balanceCents).toBe(400);
  });

  it("finds students by a case-insensitive name prefix (displayNameLower)", async () => {
    await makeUser({ uid: "quokka-1", displayName: "Quokka Anders", studentNumber: "8300010" });
    await makeUser({ uid: "quokka-2", displayName: "Quokka Baker", studentNumber: "8300011" });
    await makeUser({ uid: "quokka-3", displayName: "Wallaby Cole", studentNumber: "8300012" });

    const all = (await (
      await searchRoute(search(MEMBER.uid, "QUOKKA"))
    ).json()) as StudentSearchDTO;
    expect(all.results.map((r) => r.uid).sort()).toEqual(["quokka-1", "quokka-2"]);

    const narrowed = (await (
      await searchRoute(search(MEMBER.uid, "quokka b"))
    ).json()) as StudentSearchDTO;
    expect(narrowed.results.map((r) => r.uid)).toEqual(["quokka-2"]);
  });

  it("returns an empty list when nothing matches", async () => {
    const body = (await (
      await searchRoute(search(MEMBER.uid, "no-such-person-xyz"))
    ).json()) as StudentSearchDTO;
    expect(body.results).toEqual([]);
  });

  it("caps results at 20 for a broad name prefix", async () => {
    for (let i = 0; i < 21; i += 1) {
      await makeUser({
        uid: `wombat-${i}`,
        displayName: `Wombat ${i.toString().padStart(2, "0")}`,
        studentNumber: `84000${i.toString().padStart(2, "0")}`,
      });
    }
    const body = (await (
      await searchRoute(search(MEMBER.uid, "wombat"))
    ).json()) as StudentSearchDTO;
    expect(body.results).toHaveLength(20);
  });

  it("includes suspended accounts with the suspended flag set", async () => {
    await makeUser({
      uid: "search-suspended",
      displayName: "Suspended Sam",
      studentNumber: "8300099",
      suspended: true,
    });
    const body = (await (
      await searchRoute(search(MEMBER.uid, "8300099"))
    ).json()) as StudentSearchDTO;
    expect(body.results[0]!.suspended).toBe(true);
  });

  it("lets an exec search too (exec implies member)", async () => {
    const res = await searchRoute(search(EXEC.uid, "8300001"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as StudentSearchDTO).results).toHaveLength(1);
  });

  it("forbids a non-SAC student (defense-in-depth on top of the nav gate)", async () => {
    const res = await searchRoute(search(STUDENT.uid, "8300001"));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await searchRoute(search(null, "8300001"));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("rejects a missing query (validation)", async () => {
    const res = await searchRoute(searchRaw(MEMBER.uid, ""));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rejects unknown query params (strict scope)", async () => {
    const res = await searchRoute(searchRaw(MEMBER.uid, "?q=8300001&sneaky=1"));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it(
    "rate-limits a member past the per-minute read cap",
    async () => {
      const { limit } = RATE_LIMITS.reads;
      const dateNow = vi.spyOn(Date, "now").mockReturnValue(Date.now());
      try {
        const codes: number[] = [];
        for (let i = 0; i < limit + 1; i += 1) {
          codes.push((await searchRoute(search(RL.uid, "8300001"))).status);
        }
        expect(codes.slice(0, limit).every((s) => s === 200)).toBe(true);
        expect(codes[limit]).toBe(429);
      } finally {
        dateNow.mockRestore();
      }
    },
    RATE_LIMIT_SWEEP_TIMEOUT_MS,
  );
});

describe("GET /api/sac/students/[uid]/ledger", () => {
  let ledgerSeq = 0;
  async function freshLedgerStudent(): Promise<string> {
    ledgerSeq += 1;
    const uid = `ledger-student-${ledgerSeq}`;
    await makeUser({
      uid,
      displayName: `Ledger Student ${ledgerSeq}`,
      studentNumber: `85000${ledgerSeq.toString().padStart(2, "0")}`,
    });
    return uid;
  }

  it("returns the itemized history newest-first with actor and tags", async () => {
    const uid = await freshLedgerStudent();
    await seedEntry(uid, {
      type: "topup",
      direction: "credit",
      amountCents: 2000,
      method: "cash",
      actorName: "Mimi Member",
      pointsDelta: 100,
      atMs: BASE_MS + 1_000_000,
    });
    const purchaseId = await seedEntry(uid, {
      type: "purchase",
      direction: "debit",
      amountCents: 1650,
      balanceAfterCents: 350,
      tags: ["high-amount"],
      boothName: "Taco Booth",
      actorName: "Bea Booth",
      lineItems: [{ itemId: "taco", name: "Taco", qty: 3, unitPriceCents: 550 }],
      atMs: BASE_MS + 2_000_000,
    });

    const [req, ctx] = ledgerReq(MEMBER.uid, uid);
    const res = await ledgerRoute(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as StudentLedgerDTO;

    expect(body.entries.map((e) => e.id)).toEqual([purchaseId, expect.any(String)]);
    const purchase = body.entries[0]!;
    expect(purchase).toEqual<SacLedgerEntry>({
      id: purchaseId,
      type: "purchase",
      direction: "debit",
      amountCents: 1650,
      balanceAfterCents: 350,
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      tags: ["high-amount"],
      actorName: "Bea Booth",
      boothName: "Taco Booth",
      lineItems: [{ itemId: "taco", name: "Taco", qty: 3, unitPriceCents: 550 }],
    });
    const topup = body.entries[1]!;
    expect(topup.type).toBe("topup");
    expect(topup.method).toBe("cash");
    expect(topup.pointsDelta).toBe(100);
    expect(body.nextCursor).toBeNull();
  });

  it("returns an empty page with no cursor for a student with no history", async () => {
    const uid = await freshLedgerStudent();
    const [req, ctx] = ledgerReq(MEMBER.uid, uid);
    const body = (await (await ledgerRoute(req, ctx)).json()) as StudentLedgerDTO;
    expect(body).toEqual({ entries: [], nextCursor: null });
  });

  it("paginates with a stable cursor across page boundaries", async () => {
    const uid = await freshLedgerStudent();
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      ids.push(await seedEntry(uid, { atMs: BASE_MS + 3_000_000 + i * 1000 }));
    }
    const newestFirst = [...ids].reverse();

    const [req1, ctx1] = ledgerReq(MEMBER.uid, uid);
    const page1 = (await (await ledgerRoute(req1, ctx1)).json()) as StudentLedgerDTO;
    expect(page1.entries).toHaveLength(25);
    expect(page1.entries.map((e) => e.id)).toEqual(newestFirst.slice(0, 25));
    expect(page1.nextCursor).toBe(newestFirst[24]);

    const [req2, ctx2] = ledgerReq(MEMBER.uid, uid, page1.nextCursor!);
    const page2 = (await (await ledgerRoute(req2, ctx2)).json()) as StudentLedgerDTO;
    expect(page2.entries).toHaveLength(5);
    expect(page2.entries.map((e) => e.id)).toEqual(newestFirst.slice(25));
    expect(page2.nextCursor).toBeNull();

    const seen = [...page1.entries, ...page2.entries].map((e) => e.id);
    expect(new Set(seen).size).toBe(30);
  });

  it("treats an unknown cursor as the first page rather than erroring", async () => {
    const uid = await freshLedgerStudent();
    for (let i = 0; i < 3; i += 1) {
      await seedEntry(uid, { atMs: BASE_MS + 4_000_000 + i * 1000 });
    }
    const [req, ctx] = ledgerReq(MEMBER.uid, uid, "does-not-exist");
    const body = (await (await ledgerRoute(req, ctx)).json()) as StudentLedgerDTO;
    expect(body.entries).toHaveLength(3);
  });

  it("returns only the target student's entries", async () => {
    const uid = await freshLedgerStudent();
    const other = await freshLedgerStudent();
    const mine = await seedEntry(uid, { atMs: BASE_MS + 5_000_000 });
    const theirs = await seedEntry(other, { atMs: BASE_MS + 5_000_000 });

    const [req, ctx] = ledgerReq(MEMBER.uid, uid);
    const body = (await (await ledgerRoute(req, ctx)).json()) as StudentLedgerDTO;
    const ids = body.entries.map((e) => e.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("lets an exec view a ledger (exec implies member)", async () => {
    const uid = await freshLedgerStudent();
    await seedEntry(uid, { atMs: BASE_MS + 6_000_000 });
    const [req, ctx] = ledgerReq(EXEC.uid, uid);
    const res = await ledgerRoute(req, ctx);
    expect(res.status).toBe(200);
    expect(((await res.json()) as StudentLedgerDTO).entries).toHaveLength(1);
  });

  it("forbids a non-SAC student from viewing a ledger", async () => {
    const uid = await freshLedgerStudent();
    const [req, ctx] = ledgerReq(STUDENT.uid, uid);
    const res = await ledgerRoute(req, ctx);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated ledger request", async () => {
    const uid = await freshLedgerStudent();
    const [req, ctx] = ledgerReq(null, uid);
    const res = await ledgerRoute(req, ctx);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });
});
