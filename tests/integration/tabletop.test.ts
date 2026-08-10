import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import { POST as adjustRoute } from "../../src/app/api/exec/adjust/route";
import { POST as approveRoute } from "../../src/app/api/exec/booths/[id]/approve/route";
import { POST as paymentCodeRoute } from "../../src/app/api/exec/payment-code/route";
import { POST as refundRoute } from "../../src/app/api/exec/refund/route";
import { POST as rolesRoute } from "../../src/app/api/exec/roles/route";
import { POST as suspendRoute } from "../../src/app/api/exec/suspend/route";
import { GET as feedRoute } from "../../src/app/api/sac/feed/route";
import { POST as lookupRoute } from "../../src/app/api/sac/lookup/route";
import { GET as reconciliationRoute } from "../../src/app/api/sac/reconciliation/route";
import { GET as reportsRoute } from "../../src/app/api/sac/reports/route";
import { POST as topupRoute } from "../../src/app/api/sac/topup/route";
import { boothsCol, ledgerCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { computeLeaderboard } from "../../src/lib/server/leaderboard";
import { SESSION_TTL_MS, TIMEZONE } from "../../src/lib/shared/constants";
import type {
  BoothItem,
  FeedDTO,
  LeaderboardDTO,
  ReconciliationDTO,
  ReportsDTO,
} from "../../src/lib/shared/types";

const AVA = { uid: "tt-ava", name: "Ava Nguyen", num: "9001" };
const BEN = { uid: "tt-ben", name: "Ben Carter", num: "9002" };
const CHLOE = { uid: "tt-chloe", name: "Chloe Diaz", num: "9003" };
const SAM = { uid: "tt-sam", name: "Sam Lee" };
const RILEY = { uid: "tt-riley", name: "Riley Kim" };

const PIZZA = "tt-pizza";
const TACO = "tt-taco";
const CANDY = "tt-candy";
const SUBMITTER_EMAIL = "jmurray@pdsb.net";

const PIZZA_ITEMS: BoothItem[] = [
  { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
  { id: "slice", name: "Slice", priceCents: 300, isCustom: false },
  { id: "pie", name: "Whole Pie", priceCents: 1500, isCustom: false },
];

const cookies: Record<string, string> = {};

function todayToronto(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
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

interface CallResult {
  status: number;
  json: { error?: { code?: string }; [key: string]: unknown };
}

type Handler = (request: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;

async function call(
  handler: Handler,
  opts: {
    uid: string;
    method?: "GET" | "POST";
    body?: unknown;
    query?: Record<string, string>;
    params?: { id: string };
    idem?: boolean;
  },
): Promise<CallResult> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const qs = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const headers: Record<string, string> = {
    cookie: `__session=${cookies[opts.uid]}`,
    "content-type": "application/json",
  };
  if (opts.idem) headers["idempotency-key"] = randomUUID();
  const request = new Request(`http://127.0.0.1/api${qs}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const ctx = opts.params ? { params: Promise.resolve(opts.params) } : undefined;
  const res = await handler(request, ctx);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function code(r: CallResult): string | undefined {
  return r.json?.error?.code;
}

async function makeUser(
  u: { uid: string; name: string; num?: string },
  roles: { sacMember: boolean; sacExec: boolean },
  extra: { paymentCode?: string } = {},
): Promise<void> {
  await usersCol()
    .doc(u.uid)
    .set({
      email: `${u.uid}@pdsb.net`,
      displayName: u.name,
      displayNameLower: u.name.toLowerCase(),
      studentNumber: u.num ?? null,
      paymentCode: extra.paymentCode ?? `fp1-${u.uid}`,
      balanceCents: 0,
      points: 0,
      roles,
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function makeBooth(
  id: string,
  status: "pending" | "approved" | "deactivated",
  items: BoothItem[],
  name: string,
): Promise<void> {
  await boothsCol()
    .doc(id)
    .set({
      name,
      nameLower: name.toLowerCase(),
      description: "tabletop booth",
      status,
      items: items.map((i) => ({ ...i })),
      joinCode: status === "pending" ? null : `${id}-01`,
      submitterUid: "tt-teacher",
      submitterEmail: SUBMITTER_EMAIL,
      createdAt: Timestamp.now(),
      ...(status !== "pending" ? { approvedAt: Timestamp.now(), approvedByUid: RILEY.uid } : {}),
    });
}

beforeAll(async () => {
  await makeUser(AVA, { sacMember: false, sacExec: false });
  await makeUser(BEN, { sacMember: false, sacExec: false });
  await makeUser(CHLOE, { sacMember: false, sacExec: false }, { paymentCode: "fp1-CHLOE-OLD" });
  await makeUser(SAM, { sacMember: true, sacExec: false });
  await makeUser(RILEY, { sacMember: true, sacExec: true });

  await makeBooth(PIZZA, "approved", PIZZA_ITEMS, "Pizza Palace");
  await makeBooth(TACO, "pending", PIZZA_ITEMS, "Taco Stand");
  await makeBooth(CANDY, "deactivated", PIZZA_ITEMS, "Candy Corner");

  await membersCol(PIZZA)
    .doc(AVA.uid)
    .set({ uid: AVA.uid, displayName: AVA.name, joinedAt: Timestamp.now() });

  for (const u of [AVA, BEN, CHLOE, SAM, RILEY]) {
    cookies[u.uid] = await mintSessionCookie(u.uid);
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "auditLog", "rateLimits", "idempotency"].map((n) =>
      db.recursiveDelete(db.collection(n)),
    ),
  );
  await db.recursiveDelete(db.collection("booths"));
});

describe("Tabletop — full event hour", () => {
  it("drives top-ups, sale, refund, adjustment, suspend, approval; feed/reconciliation/reports/leaderboard reconcile to a hand-tally", async () => {
    // Top-ups: member + exec, both methods (baseline for the reconciliation split).
    const p0a = await call(topupRoute, {
      uid: SAM.uid,
      body: { buyer: { studentNumber: AVA.num }, amountCents: 5000, method: "cash" },
      idem: true,
    });
    expect(p0a.status).toBe(200);
    expect(p0a.json.balanceAfterCents).toBe(5000);
    expect(p0a.json.points).toBe(250);

    expect(
      (
        await call(topupRoute, {
          uid: SAM.uid,
          body: { buyer: { studentNumber: BEN.num }, amountCents: 2000, method: "cash" },
          idem: true,
        })
      ).status,
    ).toBe(200);

    expect(
      (
        await call(topupRoute, {
          uid: RILEY.uid,
          body: { buyer: { studentNumber: CHLOE.num }, amountCents: 4000, method: "cash" },
          idem: true,
        })
      ).status,
    ).toBe(200);

    const benTopup = await call(topupRoute, {
      uid: RILEY.uid,
      body: { buyer: { studentNumber: BEN.num }, amountCents: 1000, method: "card" },
      idem: true,
    });
    expect(benTopup.status).toBe(200);
    const benTopupEntryId = benTopup.json.entryId as string;

    const t3 = await call(topupRoute, {
      uid: SAM.uid,
      body: { buyer: { studentNumber: AVA.num }, amountCents: 2000, method: "cash" },
      idem: true,
    });
    expect(t3.json.balanceAfterCents).toBe(7000);

    // Name-confirm lookup for the top-up flow.
    const look = await call(lookupRoute, {
      uid: RILEY.uid,
      body: { buyer: { studentNumber: AVA.num } },
    });
    expect(look.status).toBe(200);
    expect(look.json).toMatchObject({ name: AVA.name, balanceCents: 7000 });

    // Cap guard: member blocked, exec without reason blocked, exec override succeeds + tagged.
    const capMember = await call(topupRoute, {
      uid: SAM.uid,
      body: { buyer: { studentNumber: CHLOE.num }, amountCents: 15000, method: "cash" },
      idem: true,
    });
    expect(code(capMember)).toBe("CAP_EXCEEDED");

    const capNoReason = await call(topupRoute, {
      uid: RILEY.uid,
      body: { buyer: { studentNumber: CHLOE.num }, amountCents: 15000, method: "cash" },
      idem: true,
    });
    expect(code(capNoReason)).toBe("CAP_EXCEEDED");

    const capOverride = await call(topupRoute, {
      uid: RILEY.uid,
      body: {
        buyer: { studentNumber: CHLOE.num },
        amountCents: 15000,
        method: "cash",
        overrideReason: "Parent prepaid grad account",
      },
      idem: true,
    });
    expect(capOverride.status).toBe(200);
    expect(capOverride.json.balanceAfterCents).toBe(19000);
    expect(
      (
        await ledgerCol()
          .doc(capOverride.json.entryId as string)
          .get()
      ).data()?.tags,
    ).toContain("cap-override");

    // POS sale from a booth member: high-amount tag; Ben $30 -> $12.
    const sale = await call(chargeRoute, {
      uid: AVA.uid,
      body: {
        boothId: PIZZA,
        buyer: { paymentCode: `fp1-${BEN.uid}` },
        items: [
          { itemId: "pie", qty: 1 },
          { itemId: "slice", qty: 1 },
        ],
      },
      idem: true,
    });
    expect(sale.status).toBe(200);
    expect(sale.json.amountCents).toBe(1800);
    const saleEntryId = sale.json.entryId as string;
    expect((await ledgerCol().doc(saleEntryId).get()).data()?.tags).toContain("high-amount");

    // Insufficient funds is blocked.
    expect(
      code(
        await call(chargeRoute, {
          uid: AVA.uid,
          body: {
            boothId: PIZZA,
            buyer: { paymentCode: `fp1-${BEN.uid}` },
            items: [{ itemId: "pie", qty: 1 }],
          },
          idem: true,
        }),
      ),
    ).toBe("INSUFFICIENT_FUNDS");

    // Dispute -> per-line refund; Ben $12 -> $27.
    expect(
      (
        await call(refundRoute, {
          uid: RILEY.uid,
          body: {
            originalEntryId: saleEntryId,
            lineItems: [{ itemId: "pie", qty: 1 }],
            reason: "Pizza never delivered",
          },
          idem: true,
        })
      ).status,
    ).toBe(200);
    expect((await usersCol().doc(BEN.uid).get()).data()?.balanceCents).toBe(2700);

    // Wrong top-up -> linked adjustment reverses points; Ben $27 -> $17, points 150 -> 100.
    expect(
      (
        await call(adjustRoute, {
          uid: RILEY.uid,
          body: {
            studentUid: BEN.uid,
            amountCents: -1000,
            reason: "Card declined, reversing top-up",
            originalEntryId: benTopupEntryId,
          },
          idem: true,
        })
      ).status,
    ).toBe(200);
    const ben = (await usersCol().doc(BEN.uid).get()).data();
    expect(ben?.balanceCents).toBe(1700);
    expect(ben?.points).toBe(100);

    // Suspend blocks charge + top-up instantly, then unsuspend.
    expect(
      (
        await call(suspendRoute, {
          uid: RILEY.uid,
          body: { studentUid: CHLOE.uid, suspended: true },
        })
      ).status,
    ).toBe(200);
    expect(
      code(
        await call(chargeRoute, {
          uid: AVA.uid,
          body: {
            boothId: PIZZA,
            buyer: { paymentCode: "fp1-CHLOE-OLD" },
            items: [{ itemId: "slice", qty: 1 }],
          },
          idem: true,
        }),
      ),
    ).toBe("SUSPENDED");
    expect(
      code(
        await call(topupRoute, {
          uid: RILEY.uid,
          body: { buyer: { studentNumber: CHLOE.num }, amountCents: 1000, method: "cash" },
          idem: true,
        }),
      ),
    ).toBe("SUSPENDED");
    expect(
      (
        await call(suspendRoute, {
          uid: RILEY.uid,
          body: { studentUid: CHLOE.uid, suspended: false },
        })
      ).status,
    ).toBe(200);

    // Payment-code regen invalidates the old code immediately.
    expect(
      (
        await call(lookupRoute, {
          uid: RILEY.uid,
          body: { buyer: { paymentCode: "fp1-CHLOE-OLD" } },
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(paymentCodeRoute, { uid: RILEY.uid, body: { studentUid: CHLOE.uid } })).status,
    ).toBe(200);
    expect(
      code(
        await call(lookupRoute, {
          uid: RILEY.uid,
          body: { buyer: { paymentCode: "fp1-CHLOE-OLD" } },
        }),
      ),
    ).toBe("NOT_FOUND");

    // Approve the pending booth: submitter email is on the record, join code minted.
    const approve = await call(approveRoute, { uid: RILEY.uid, body: {}, params: { id: TACO } });
    expect(approve.status).toBe(200);
    const taco = (await boothsCol().doc(TACO).get()).data();
    expect(taco?.status).toBe("approved");
    expect(taco?.joinCode).toBeTruthy();
    expect(taco?.submitterEmail).toBe(SUBMITTER_EMAIL);

    // Exec gating + last-exec lockout guard.
    expect(
      (await call(suspendRoute, { uid: SAM.uid, body: { studentUid: BEN.uid, suspended: true } }))
        .status,
    ).toBe(403);
    expect(
      (
        await call(rolesRoute, {
          uid: SAM.uid,
          body: { targetUid: BEN.uid, role: "sacMember", grant: true },
        })
      ).status,
    ).toBe(403);
    expect(
      code(
        await call(rolesRoute, {
          uid: RILEY.uid,
          body: { targetUid: RILEY.uid, role: "sacExec", grant: false },
        }),
      ),
    ).toBe("CONFLICT");

    // Read models vs hand-tally.
    const date = todayToronto();
    const recon = (await call(reconciliationRoute, { uid: SAM.uid, query: { date } }))
      .json as unknown as ReconciliationDTO;
    const sam = recon.members.find((m) => m.actorUid === SAM.uid)!;
    const riley = recon.members.find((m) => m.actorUid === RILEY.uid)!;
    expect(sam).toMatchObject({ cashCents: 9000, cashCount: 3, cardCents: 0 });
    expect(riley).toMatchObject({ cashCents: 19000, cashCount: 2, cardCents: 1000, cardCount: 1 });
    expect(recon.totals).toMatchObject({ cashCents: 28000, cardCents: 1000, topupCount: 6 });
    expect(riley.corrections.length).toBe(1);

    const reports = (await call(reportsRoute, { uid: RILEY.uid })).json as unknown as ReportsDTO;
    const pizza = reports.booths.find((b) => b.boothId === PIZZA)!;
    expect(pizza).toMatchObject({ grossCents: 300, purchaseCount: 1, refundCount: 1 });
    expect(reports.topups).toMatchObject({
      cashCents: 28000,
      cardCents: 1000,
      totalCents: 29000,
      count: 6,
    });
    expect(reports.outstandingLiabilityCents).toBe(27700);

    const board: LeaderboardDTO = await computeLeaderboard();
    expect(board.rows[0]).toMatchObject({ rank: 1, boothId: PIZZA, grossCents: 300 });
    expect(board.rows.map((r) => r.boothId).sort()).toEqual([CANDY, PIZZA, TACO].sort());

    // Feed catches everything, filters behave.
    const feedAll = (await call(feedRoute, { uid: SAM.uid })).json as unknown as FeedDTO;
    expect(feedAll.entries.some((e) => "tags" in e && e.tags.includes("high-amount"))).toBe(true);

    const feedTopups = (await call(feedRoute, { uid: SAM.uid, query: { type: "topup" } }))
      .json as unknown as FeedDTO;
    expect(feedTopups.entries.length).toBe(6);
    expect(feedTopups.entries.every((e) => "type" in e && e.type === "topup")).toBe(true);

    const feedBooth = (await call(feedRoute, { uid: SAM.uid, query: { boothId: PIZZA } }))
      .json as unknown as FeedDTO;
    const boothTypes = new Set(feedBooth.entries.flatMap((e) => ("type" in e ? [e.type] : [])));
    expect(boothTypes.has("purchase") && boothTypes.has("refund")).toBe(true);

    const feedActor = (await call(feedRoute, { uid: SAM.uid, query: { actorUid: RILEY.uid } }))
      .json as unknown as FeedDTO;
    const actorKinds = new Set(feedActor.entries.map((e) => ("action" in e ? "audit" : "ledger")));
    expect(actorKinds.has("ledger") && actorKinds.has("audit")).toBe(true);
  });
});
