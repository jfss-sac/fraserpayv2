import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as feedRoute } from "../../src/app/api/sac/feed/route";
import {
  type AuditLogDoc,
  type LedgerEntryDoc,
  auditCol,
  ledgerCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { FEED_PAGE_SIZE, getFeed } from "../../src/lib/server/sac-feed";
import { RATE_LIMITS } from "../../src/lib/server/ratelimit";
import {
  REPEAT_BUYER_THRESHOLD,
  REPEAT_BUYER_WINDOW_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from "../../src/lib/shared/constants";
import type { FeedDTO, FeedEntry } from "../../src/lib/shared/types";

const RATE_LIMIT_SWEEP_TIMEOUT_MS = 60_000;

const ORIGIN = "http://127.0.0.1";

const MEMBER = { uid: "feed-member", name: "Mimi Member" };
const EXEC = { uid: "feed-exec", name: "Xavi Exec" };
const STUDENT = { uid: "feed-student", name: "Stu Dent" };
const RL = { uid: "feed-rl", name: "Rex Ratelimit" };

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
const BASE_MS = 1_700_000_000_000;

async function seedLedger(
  overrides: Partial<LedgerEntryDoc> & { atMs?: number } = {},
): Promise<string> {
  seq += 1;
  const { atMs, ...rest } = overrides;
  const entry: LedgerEntryDoc = {
    type: "purchase",
    amountCents: 100,
    direction: "debit",
    balanceAfterCents: 0,
    studentUid: "some-student",
    studentNumber: "700001",
    studentName: "Seed Student",
    actorUid: "seed-actor",
    actorName: "Seed Actor",
    tags: [],
    idempotencyKey: `feed-seed-${seq}`,
    createdAt: Timestamp.fromMillis(atMs ?? BASE_MS + seq * 1000),
    createdDate: "2023-11-14",
    ...rest,
  };
  const ref = ledgerCol().doc();
  await ref.set(entry);
  return ref.id;
}

async function seedAudit(
  overrides: Partial<AuditLogDoc> & { atMs?: number } = {},
): Promise<string> {
  seq += 1;
  const { atMs, ...rest } = overrides;
  const entry: AuditLogDoc = {
    action: "user.suspend",
    actorUid: "seed-actor",
    actorName: "Seed Actor",
    targetType: "user",
    targetId: "u1",
    targetLabel: "Some User",
    details: {},
    createdAt: Timestamp.fromMillis(atMs ?? BASE_MS + seq * 1000),
    ...rest,
  };
  const ref = auditCol().doc();
  await ref.set(entry);
  return ref.id;
}

function feedReq(actor: string | null, query = ""): Request {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/sac/feed${query}`, { method: "GET", headers });
}

async function getFeedBody(actor: string | null, query = ""): Promise<FeedDTO> {
  return (await (await feedRoute(feedReq(actor, query))).json()) as FeedDTO;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function drain(query = ""): Promise<FeedEntry[]> {
  const all: FeedEntry[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const suffix: string = cursor
      ? `${query ? `${query}&` : "?"}cursor=${encodeURIComponent(cursor)}`
      : query;
    const body = await getFeedBody(MEMBER.uid, suffix);
    all.push(...body.entries);
    if (!body.nextCursor) return all;
    cursor = body.nextCursor;
  }
  throw new Error("drain did not terminate");
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser(MEMBER.uid, MEMBER.name, { sacMember: true, sacExec: false });
  await makeUser(EXEC.uid, EXEC.name, { sacMember: true, sacExec: true });
  await makeUser(STUDENT.uid, STUDENT.name, { sacMember: false, sacExec: false });
  await makeUser(RL.uid, RL.name, { sacMember: true, sacExec: false });

  cookies[MEMBER.uid] = await mintSessionCookie(MEMBER.uid);
  cookies[EXEC.uid] = await mintSessionCookie(EXEC.uid);
  cookies[STUDENT.uid] = await mintSessionCookie(STUDENT.uid);
  cookies[RL.uid] = await mintSessionCookie(RL.uid);
});

beforeEach(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["ledger", "auditLog", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))),
  );
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "auditLog", "rateLimits"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  vi.restoreAllMocks();
});

describe("GET /api/sac/feed — access & validation", () => {
  it("lets a SAC member read with no-store", async () => {
    const res = await feedRoute(feedReq(MEMBER.uid));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()) as FeedDTO).toEqual({
      entries: [],
      nextCursor: null,
      repeatBuyers: [],
    });
  });

  it("lets an exec read (exec implies member)", async () => {
    const res = await feedRoute(feedReq(EXEC.uid));
    expect(res.status).toBe(200);
  });

  it("forbids a non-SAC student (defense-in-depth on top of the nav gate)", async () => {
    const res = await feedRoute(feedReq(STUDENT.uid));
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await feedRoute(feedReq(null));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("rejects unknown query params (strict scope)", async () => {
    const res = await feedRoute(feedReq(MEMBER.uid, "?bogus=1"));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rejects an invalid type value", async () => {
    const res = await feedRoute(feedReq(MEMBER.uid, "?type=bogus"));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rejects a tag other than high-amount", async () => {
    const res = await feedRoute(feedReq(MEMBER.uid, "?tag=cap-override"));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("rejects combining more than one filter dimension", async () => {
    const res = await feedRoute(feedReq(MEMBER.uid, "?type=topup&actorUid=seed-actor"));
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });
});

describe("GET /api/sac/feed — merge ordering", () => {
  it("merges ledger and auditLog newest-first with a kind discriminator", async () => {
    const l1 = await seedLedger({ type: "topup", direction: "credit", atMs: BASE_MS + 1000 });
    const a1 = await seedAudit({ action: "booth.approve", atMs: BASE_MS + 2000 });
    const l2 = await seedLedger({ atMs: BASE_MS + 3000 });
    const a2 = await seedAudit({ action: "user.roleGrant", atMs: BASE_MS + 4000 });

    const body = await getFeedBody(MEMBER.uid);
    expect(body.entries.map((e) => e.id)).toEqual([a2, l2, a1, l1]);
    expect(body.entries.map((e) => e.kind)).toEqual(["audit", "ledger", "audit", "ledger"]);
    expect(body.nextCursor).toBeNull();

    const first = body.entries[0];
    if (first.kind !== "audit") throw new Error("expected an audit entry at the top");
    expect(first.action).toBe("user.roleGrant");
    const second = body.entries[1];
    if (second.kind !== "ledger") throw new Error("expected a ledger entry second");
    expect(second.type).toBe("purchase");
  });

  it("serves a feed with only audit entries", async () => {
    const a1 = await seedAudit({ atMs: BASE_MS + 1000 });
    const a2 = await seedAudit({ atMs: BASE_MS + 2000 });
    const body = await getFeedBody(MEMBER.uid);
    expect(body.entries.map((e) => e.id)).toEqual([a2, a1]);
  });
});

describe("GET /api/sac/feed — filters", () => {
  it("type filter returns only that ledger type and excludes audit", async () => {
    const topup = await seedLedger({ type: "topup", direction: "credit", atMs: BASE_MS + 1000 });
    await seedLedger({ type: "purchase", atMs: BASE_MS + 2000 });
    await seedAudit({ atMs: BASE_MS + 3000 });

    const body = await getFeedBody(MEMBER.uid, "?type=topup");
    expect(body.entries.map((e) => e.id)).toEqual([topup]);
    expect(body.entries.every((e) => e.kind === "ledger")).toBe(true);
  });

  it("boothId filter returns only that booth's ledger and excludes audit", async () => {
    const taco = await seedLedger({ boothId: "taco", boothName: "Taco", atMs: BASE_MS + 1000 });
    await seedLedger({ boothId: "pizza", boothName: "Pizza", atMs: BASE_MS + 2000 });
    await seedAudit({ atMs: BASE_MS + 3000 });

    const body = await getFeedBody(MEMBER.uid, "?boothId=taco");
    expect(body.entries.map((e) => e.id)).toEqual([taco]);
  });

  it("tag=high-amount filter returns only flagged ledger entries and excludes audit", async () => {
    const flagged = await seedLedger({ tags: ["high-amount"], atMs: BASE_MS + 1000 });
    await seedLedger({ tags: [], atMs: BASE_MS + 2000 });
    await seedAudit({ atMs: BASE_MS + 3000 });

    const body = await getFeedBody(MEMBER.uid, "?tag=high-amount");
    expect(body.entries.map((e) => e.id)).toEqual([flagged]);
  });

  it("actorUid filter spans BOTH ledger and audit for that actor", async () => {
    const myLedger = await seedLedger({
      actorUid: "actor-x",
      actorName: "X",
      atMs: BASE_MS + 1000,
    });
    const myAudit = await seedAudit({ actorUid: "actor-x", actorName: "X", atMs: BASE_MS + 2000 });
    await seedLedger({ actorUid: "actor-y", actorName: "Y", atMs: BASE_MS + 3000 });
    await seedAudit({ actorUid: "actor-y", actorName: "Y", atMs: BASE_MS + 4000 });

    const body = await getFeedBody(MEMBER.uid, "?actorUid=actor-x");
    expect(body.entries.map((e) => e.id)).toEqual([myAudit, myLedger]);
    expect(body.entries.map((e) => e.kind)).toEqual(["audit", "ledger"]);
  });
});

describe("GET /api/sac/feed — cursor pagination", () => {
  it("treats an unknown cursor as the first page rather than erroring", async () => {
    await seedLedger({ atMs: BASE_MS + 1000 });
    await seedAudit({ atMs: BASE_MS + 2000 });
    const body = await getFeedBody(MEMBER.uid, "?cursor=not-a-real-cursor");
    expect(body.entries).toHaveLength(2);
  });

  it("pages through a merged set exactly once, newest-first, ending with a null cursor", async () => {
    const total = FEED_PAGE_SIZE + 7;
    const ids: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const atMs = BASE_MS + 10_000 + i * 1000;
      ids.push(i % 2 === 0 ? await seedLedger({ atMs }) : await seedAudit({ atMs }));
    }
    const newestFirst = [...ids].reverse();

    const drained = await drain();
    expect(drained.map((e) => e.id)).toEqual(newestFirst);
    expect(new Set(drained.map((e) => e.id)).size).toBe(total);
  });

  it("reports the first page size and a non-null cursor when more remain", async () => {
    for (let i = 0; i < FEED_PAGE_SIZE + 3; i += 1) {
      await seedLedger({ atMs: BASE_MS + 20_000 + i * 1000 });
    }
    const body = await getFeedBody(MEMBER.uid);
    expect(body.entries).toHaveLength(FEED_PAGE_SIZE);
    expect(body.nextCursor).not.toBeNull();
  });
});

describe("GET /api/sac/feed — cursor stability", () => {
  it("is unaffected by newer inserts made after the first page was fetched", async () => {
    const total = FEED_PAGE_SIZE + 5;
    const ids: string[] = [];
    for (let i = 0; i < total; i += 1) {
      ids.push(await seedLedger({ atMs: BASE_MS + 30_000 + i * 1000 }));
    }
    const newestFirst = [...ids].reverse();

    const page1 = await getFeedBody(MEMBER.uid);
    expect(page1.entries.map((e) => e.id)).toEqual(newestFirst.slice(0, FEED_PAGE_SIZE));
    expect(page1.nextCursor).not.toBeNull();

    for (let i = 0; i < 4; i += 1) {
      await seedLedger({ atMs: BASE_MS + 500_000 + i * 1000 });
    }
    await seedAudit({ atMs: BASE_MS + 600_000 });

    const page2 = await getFeedBody(MEMBER.uid, `?cursor=${encodeURIComponent(page1.nextCursor!)}`);
    expect(page2.entries.map((e) => e.id)).toEqual(newestFirst.slice(FEED_PAGE_SIZE));
    expect(page2.nextCursor).toBeNull();

    const seen = [...page1.entries, ...page2.entries].map((e) => e.id);
    expect(new Set(seen).size).toBe(total);
  });

  it("paginates deterministically across a block of identical timestamps (id tiebreaker)", async () => {
    const total = FEED_PAGE_SIZE + 6;
    const ids = new Set<string>();
    for (let i = 0; i < total; i += 1) {
      ids.add(
        i % 2 === 0 ? await seedLedger({ atMs: BASE_MS }) : await seedAudit({ atMs: BASE_MS }),
      );
    }

    const drained = await drain();
    const drainedIds = drained.map((e) => e.id);
    expect(drainedIds).toHaveLength(total);
    expect(new Set(drainedIds).size).toBe(total);
    expect([...drainedIds].sort()).toEqual([...ids].sort());
    const descById = [...drainedIds].sort().reverse();
    expect(drainedIds).toEqual(descById);
  });
});

describe("GET /api/sac/feed — rate limiting", () => {
  it(
    "rate-limits a member past the per-minute read cap",
    async () => {
      const { limit } = RATE_LIMITS.reads;
      const codes: number[] = [];
      for (let i = 0; i < limit + 1; i += 1) {
        codes.push((await feedRoute(feedReq(RL.uid))).status);
      }
      expect(codes.slice(0, limit).every((s) => s === 200)).toBe(true);
      expect(codes[limit]).toBe(429);
    },
    RATE_LIMIT_SWEEP_TIMEOUT_MS,
  );
});

describe("GET /api/sac/feed — repeat-buyer alerts", () => {
  it("flags a buyer charged to the threshold inside the window", async () => {
    const now = BASE_MS + REPEAT_BUYER_WINDOW_MS;
    for (let i = 0; i < REPEAT_BUYER_THRESHOLD; i += 1) {
      await seedLedger({
        studentUid: "repeat-buyer",
        studentName: "Rita Repeat",
        atMs: now - 60_000,
      });
    }

    const dto = await getFeed({}, now);

    expect(dto.repeatBuyers).toEqual([
      { studentUid: "repeat-buyer", studentName: "Rita Repeat", charges: REPEAT_BUYER_THRESHOLD },
    ]);
  });

  it("ignores a burst that has aged out of the window", async () => {
    const now = BASE_MS + 4 * REPEAT_BUYER_WINDOW_MS;
    for (let i = 0; i < REPEAT_BUYER_THRESHOLD; i += 1) {
      await seedLedger({
        studentUid: "old-buyer",
        studentName: "Otto Old",
        atMs: now - REPEAT_BUYER_WINDOW_MS - 60_000,
      });
    }

    const dto = await getFeed({}, now);

    expect(dto.repeatBuyers).toEqual([]);
  });

  it("does not recompute the alert while paging older entries", async () => {
    const now = BASE_MS + REPEAT_BUYER_WINDOW_MS;
    for (let i = 0; i < REPEAT_BUYER_THRESHOLD; i += 1) {
      await seedLedger({
        studentUid: "repeat-buyer",
        studentName: "Rita Repeat",
        atMs: now - 60_000,
      });
    }

    const first = await getFeed({}, now);
    expect(first.repeatBuyers).toHaveLength(1);

    if (first.nextCursor) {
      const older = await getFeed({ cursor: first.nextCursor }, now);
      expect(older.repeatBuyers).toEqual([]);
    }
  });
});
