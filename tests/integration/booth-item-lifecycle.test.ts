import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as addRoute } from "../../src/app/api/exec/booths/[id]/items/add/route";
import { POST as archiveRoute } from "../../src/app/api/exec/booths/[id]/items/archive/route";
import { POST as repriceRoute } from "../../src/app/api/exec/booths/[id]/items/route";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import { POST as refundRoute } from "../../src/app/api/exec/refund/route";
import { getBoothForSale, getBoothSummary } from "../../src/lib/server/dal";
import {
  type AuditLogDoc,
  type BoothDoc,
  auditCol,
  boothsCol,
  ledgerCol,
  membersCol,
  usersCol,
} from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { MAX_BOOTH_ITEMS } from "../../src/lib/shared/booth";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothItem, ChargeResult } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const EXEC = { uid: "lifecycle-exec", name: "Erin Exec" };
const EXEC2 = { uid: "lifecycle-exec-2", name: "Evan Exec" };
const MEMBER = { uid: "lifecycle-member", name: "Morgan Member" };
const OPERATOR = { uid: "lifecycle-operator", name: "Opal Operator" };
const BUYER = { uid: "lifecycle-buyer", name: "Bea Buyer", code: "fp1-LIFEBUYER" };

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
  const id = `lifecycle-booth-${boothSeq}`;
  await boothsCol()
    .doc(id)
    .set({
      name: "Taco Stand",
      nameLower: "taco stand",
      description: "test booth",
      status: "approved",
      items: ITEMS.map((i) => ({ ...i })),
      joinCode: `TACO-${String(boothSeq).padStart(5, "0")}`,
      submitterUid: EXEC.uid,
      submitterEmail: `${EXEC.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
      approvedAt: Timestamp.now(),
      approvedByUid: EXEC.uid,
    });
  await membersCol(id)
    .doc(OPERATOR.uid)
    .set({ uid: OPERATOR.uid, displayName: OPERATOR.name, joinedAt: Timestamp.now() });
  return id;
}

function post(actor: string | null, path: string, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN };
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

function add(actor: string | null, id: string, body: unknown): Promise<Response> {
  return addRoute(post(actor, `/api/exec/booths/${id}/items/add`, body), {
    params: Promise.resolve({ id }),
  });
}

function archive(actor: string | null, id: string, body: unknown): Promise<Response> {
  return archiveRoute(post(actor, `/api/exec/booths/${id}/items/archive`, body), {
    params: Promise.resolve({ id }),
  });
}

function reprice(actor: string | null, id: string, body: unknown): Promise<Response> {
  return repriceRoute(post(actor, `/api/exec/booths/${id}/items`, body), {
    params: Promise.resolve({ id }),
  });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function boothDoc(id: string): Promise<BoothDoc> {
  return (await boothsCol().doc(id).get()).data()!;
}

async function audits(id: string): Promise<AuditLogDoc[]> {
  return (await auditCol().where("targetId", "==", id).get()).docs.map((d) => d.data());
}

function charge(boothId: string, itemId: string, qty = 1): Promise<Response> {
  const req = new Request(`${ORIGIN}/api/booth/charge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[OPERATOR.uid]}`,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      boothId,
      buyer: { paymentCode: BUYER.code },
      items: [{ itemId, qty }],
    }),
  });
  return chargeRoute(req);
}

function refund(body: unknown): Promise<Response> {
  const req = new Request(`${ORIGIN}/api/exec/refund`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookies[EXEC2.uid]}`,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  return refundRoute(req);
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser({
    uid: EXEC.uid,
    displayName: EXEC.name,
    paymentCode: "fp1-LIFEEXEC",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: EXEC2.uid,
    displayName: EXEC2.name,
    paymentCode: "fp1-LIFEEXEC2",
    roles: { sacMember: true, sacExec: true },
  });
  await makeUser({
    uid: MEMBER.uid,
    displayName: MEMBER.name,
    paymentCode: "fp1-LIFEMEMBER",
    roles: { sacMember: true, sacExec: false },
  });
  await makeUser({ uid: OPERATOR.uid, displayName: OPERATOR.name, paymentCode: "fp1-LIFEOPER" });
  await makeUser({
    uid: BUYER.uid,
    displayName: BUYER.name,
    paymentCode: BUYER.code,
    balanceCents: 100000,
  });

  for (const uid of [EXEC.uid, EXEC2.uid, MEMBER.uid, OPERATOR.uid]) {
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

describe("POST /api/exec/booths/[id]/items/add", () => {
  it("adds a sellable item ahead of the custom item and audits it once", async () => {
    const id = await makeApprovedBooth();
    const res = await add(EXEC.uid, id, { name: "Poutine", priceCents: 450 });
    expect(res.status).toBe(200);

    const { item } = (await res.json()) as { item: BoothItem };
    expect(item).toEqual({
      id: expect.any(String),
      name: "Poutine",
      priceCents: 450,
      isCustom: false,
    });
    expect(item.id).not.toBe("custom");

    const booth = await boothDoc(id);
    expect(booth.items.map((i) => i.name)).toEqual(["Coffee", "Tea", "Poutine", "Custom"]);
    expect(booth.items.at(-1)).toEqual(ITEMS[2]);

    const rows = await audits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("booth.itemAdd");
    expect(rows[0]!.actorUid).toBe(EXEC.uid);
    expect(rows[0]!.targetLabel).toBe("Taco Stand");
    expect(rows[0]!.details).toEqual({ itemId: item.id, name: "Poutine", priceCents: 450 });
    for (const value of Object.values(rows[0]!.details)) {
      expect(typeof value).not.toBe("object");
    }

    const sale = await charge(id, item.id, 2);
    expect(sale.status).toBe(200);
    expect(((await sale.json()) as ChargeResult).amountCents).toBe(900);
  });

  it("assigns a fresh id per add, so an added item can never overwrite another", async () => {
    const id = await makeApprovedBooth();
    const first = (await (
      await add(EXEC.uid, id, { name: "Poutine", priceCents: 450 })
    ).json()) as {
      item: BoothItem;
    };
    const second = (await (
      await add(EXEC.uid, id, { name: "Poutine", priceCents: 450 })
    ).json()) as { item: BoothItem };

    expect(second.item.id).not.toBe(first.item.id);
    expect((await boothDoc(id)).items).toHaveLength(5);
  });

  it("rejects a client-supplied item id, leaving the custom item untouched", async () => {
    const id = await makeApprovedBooth();
    const res = await add(EXEC.uid, id, { id: "custom", name: "Custom", priceCents: 900 });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");

    expect((await boothDoc(id)).items).toEqual(ITEMS);
    expect(await audits(id)).toHaveLength(0);
  });

  it("rejects a price that is not a multiple of $0.50", async () => {
    const id = await makeApprovedBooth();
    const res = await add(EXEC.uid, id, { name: "Poutine", priceCents: 449 });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect((await boothDoc(id)).items).toEqual(ITEMS);
  });

  it("rejects a blank name", async () => {
    const id = await makeApprovedBooth();
    const res = await add(EXEC.uid, id, { name: "   ", priceCents: 450 });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
  });

  it("refuses to grow a booth past the item count registration allows", async () => {
    const id = await makeApprovedBooth();
    await boothsCol()
      .doc(id)
      .update({
        items: [
          ...Array.from({ length: MAX_BOOTH_ITEMS }, (_, i) => ({
            id: `bulk-${i}`,
            name: `Item ${i}`,
            priceCents: 100,
            isCustom: false,
          })),
          { ...ITEMS[2]! },
        ],
      });

    const res = await add(EXEC.uid, id, { name: "Poutine", priceCents: 450 });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
    expect((await boothDoc(id)).items).toHaveLength(MAX_BOOTH_ITEMS + 1);
    expect(await audits(id)).toHaveLength(0);
  });

  it("frees a slot when an item is archived, so items can be swapped mid-event", async () => {
    const id = await makeApprovedBooth();
    await boothsCol()
      .doc(id)
      .update({
        items: [
          ...Array.from({ length: MAX_BOOTH_ITEMS }, (_, i) => ({
            id: `bulk-${i}`,
            name: `Item ${i}`,
            priceCents: 100,
            isCustom: false,
          })),
          { ...ITEMS[2]! },
        ],
      });

    expect((await archive(EXEC.uid, id, { itemId: "bulk-0", archived: true })).status).toBe(200);

    const res = await add(EXEC.uid, id, { name: "Poutine", priceCents: 450 });
    expect(res.status).toBe(200);
    expect((await boothDoc(id)).items).toHaveLength(MAX_BOOTH_ITEMS + 2);
  });

  it("forbids a SAC member who is not an exec", async () => {
    const id = await makeApprovedBooth();
    const res = await add(MEMBER.uid, id, { name: "Poutine", priceCents: 450 });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect((await boothDoc(id)).items).toEqual(ITEMS);
    expect(await audits(id)).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const id = await makeApprovedBooth();
    const res = await add(null, id, { name: "Poutine", priceCents: 450 });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("returns NOT_FOUND for a booth that does not exist", async () => {
    const res = await add(EXEC.uid, "no-such-booth", { name: "Poutine", priceCents: 450 });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });
});

describe("POST /api/exec/booths/[id]/items/archive", () => {
  it("hides an archived item from catalog reads without removing it", async () => {
    const id = await makeApprovedBooth();
    const res = await archive(EXEC.uid, id, { itemId: "coffee", archived: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ boothId: id, itemId: "coffee", archived: true });

    const booth = await boothDoc(id);
    expect(booth.items.map((i) => i.id)).toEqual(["coffee", "tea", "custom"]);
    expect(booth.items[0]).toEqual({ ...ITEMS[0], archived: true });

    const catalog = await getBoothForSale(id);
    expect(catalog!.items.map((i) => i.id)).toEqual(["tea", "custom"]);

    const rows = await audits(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("booth.itemArchive");
    expect(rows[0]!.actorUid).toBe(EXEC.uid);
    expect(rows[0]!.details).toEqual({ itemId: "coffee", name: "Coffee" });
  });

  it("restores an archived item and leaves no archived flag behind", async () => {
    const id = await makeApprovedBooth();
    await archive(EXEC.uid, id, { itemId: "coffee", archived: true });

    const res = await archive(EXEC.uid, id, { itemId: "coffee", archived: false });
    expect(res.status).toBe(200);

    const booth = await boothDoc(id);
    expect(booth.items[0]).toEqual(ITEMS[0]);
    expect(Object.keys(booth.items[0]!)).not.toContain("archived");

    const catalog = await getBoothForSale(id);
    expect(catalog!.items.map((i) => i.id)).toEqual(["coffee", "tea", "custom"]);

    const rows = await audits(id);
    expect(rows.map((r) => r.action).sort()).toEqual(["booth.itemArchive", "booth.itemUnarchive"]);
  });

  it("rejects archiving the custom item", async () => {
    const id = await makeApprovedBooth();
    const res = await archive(EXEC.uid, id, { itemId: "custom", archived: true });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect((await boothDoc(id)).items).toEqual(ITEMS);
    expect(await audits(id)).toHaveLength(0);
  });

  it("rejects an unknown item", async () => {
    const id = await makeApprovedBooth();
    const res = await archive(EXEC.uid, id, { itemId: "ghost", archived: true });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");
    expect(await audits(id)).toHaveLength(0);
  });

  it("conflicts on a repeat archive, writing no second audit entry", async () => {
    const id = await makeApprovedBooth();
    expect((await archive(EXEC.uid, id, { itemId: "tea", archived: true })).status).toBe(200);

    const res = await archive(EXEC.uid, id, { itemId: "tea", archived: true });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
    expect(await audits(id)).toHaveLength(1);
  });

  it("conflicts on restoring an item that was never archived", async () => {
    const id = await makeApprovedBooth();
    const res = await archive(EXEC.uid, id, { itemId: "tea", archived: false });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("CONFLICT");
    expect(await audits(id)).toHaveLength(0);
  });

  it("forbids a SAC member who is not an exec", async () => {
    const id = await makeApprovedBooth();
    const res = await archive(MEMBER.uid, id, { itemId: "coffee", archived: true });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
    expect((await boothDoc(id)).items).toEqual(ITEMS);
    expect(await audits(id)).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const id = await makeApprovedBooth();
    const res = await archive(null, id, { itemId: "coffee", archived: true });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("returns NOT_FOUND for a booth that does not exist", async () => {
    const res = await archive(EXEC.uid, "no-such-booth", { itemId: "coffee", archived: true });
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });
});

describe("POST /api/exec/booths/[id]/items (reprice)", () => {
  it("rejects a price edit targeting an archived item", async () => {
    const id = await makeApprovedBooth();
    await archive(EXEC.uid, id, { itemId: "coffee", archived: true });

    const res = await reprice(EXEC.uid, id, { priceEdits: [{ id: "coffee", priceCents: 300 }] });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("VALIDATION");

    const booth = await boothDoc(id);
    expect(booth.items[0]).toEqual({ ...ITEMS[0], archived: true });
    expect(await audits(id)).toHaveLength(1);
  });

  it("still reprices an active item on a booth that has archived items", async () => {
    const id = await makeApprovedBooth();
    await archive(EXEC.uid, id, { itemId: "coffee", archived: true });

    const res = await reprice(EXEC.uid, id, { priceEdits: [{ id: "tea", priceCents: 300 }] });
    expect(res.status).toBe(200);
    expect((await boothDoc(id)).items[1]!.priceCents).toBe(300);
  });
});

describe("frozen history (decision 3)", () => {
  it("keeps a completed sale identical across a reprice and an archive", async () => {
    const id = await makeApprovedBooth();

    const sale = await charge(id, "coffee", 2);
    expect(sale.status).toBe(200);
    const { entryId } = (await sale.json()) as ChargeResult;

    const before = (await ledgerCol().doc(entryId).get()).data()!;
    const summaryBefore = await getBoothSummary(id);
    expect(before.lineItems).toEqual([
      { itemId: "coffee", name: "Coffee", qty: 2, unitPriceCents: 250 },
    ]);
    expect(summaryBefore!.items).toEqual([
      { itemId: "coffee", name: "Coffee", qty: 2, revenueCents: 500 },
    ]);

    expect(
      (await reprice(EXEC.uid, id, { priceEdits: [{ id: "coffee", priceCents: 600 }] })).status,
    ).toBe(200);
    expect((await archive(EXEC.uid, id, { itemId: "coffee", archived: true })).status).toBe(200);

    const after = (await ledgerCol().doc(entryId).get()).data()!;
    expect(after).toEqual(before);
    expect(after.lineItems![0]!.unitPriceCents).toBe(250);
    expect(after.amountCents).toBe(500);
    expect(await getBoothSummary(id)).toEqual(summaryBefore);

    const partial = await refund({
      originalEntryId: entryId,
      reason: "one coffee spilled",
      lineItems: [{ itemId: "coffee", qty: 1 }],
    });
    expect(partial.status).toBe(200);
    expect((await partial.json()) as { amountCents: number }).toMatchObject({ amountCents: 250 });

    expect((await ledgerCol().doc(entryId).get()).data()).toEqual(before);
  });
});
