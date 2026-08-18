import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as catalogRoute } from "../../src/app/api/booth/[id]/catalog/route";
import { getBoothCatalog } from "../../src/lib/server/dal";
import { boothsCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";
import type { BoothDTO, BoothItem, BoothStatus } from "../../src/lib/shared/types";

const ORIGIN = "http://127.0.0.1";

const SELLER = { uid: "catalog-seller", name: "Sable Seller" };
const OUTSIDER = { uid: "catalog-outsider", name: "Otto Outsider" };

const BOOTH_ID = "catalog-booth";
const PENDING_BOOTH_ID = "catalog-pending-booth";
const DEACTIVATED_BOOTH_ID = "catalog-deactivated-booth";
const GHOST_BOOTH_ID = "catalog-ghost-booth";

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "tea", name: "Tea", priceCents: 200, isCustom: false, archived: true },
  { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false },
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

async function makeUser(uid: string, displayName: string): Promise<void> {
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
      roles: { sacMember: false, sacExec: false },
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

async function makeBooth(id: string, status: BoothStatus): Promise<void> {
  await boothsCol()
    .doc(id)
    .set({
      name: `Booth ${id}`,
      nameLower: `booth ${id}`,
      description: "A booth with a menu",
      status,
      items: ITEMS.map((item) => ({ ...item })),
      joinCode: status === "approved" ? "BOOT-6M2P9" : null,
      submitterUid: SELLER.uid,
      submitterEmail: `${SELLER.uid}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
  await membersCol(id)
    .doc(SELLER.uid)
    .set({ uid: SELLER.uid, displayName: SELLER.name, joinedAt: Timestamp.now() });
}

function catalogRequest(actor: string | null, boothId: string): Request {
  const headers: Record<string, string> = {};
  if (actor) headers.cookie = `${SESSION_COOKIE_NAME}=${cookies[actor]}`;
  return new Request(`${ORIGIN}/api/booth/${boothId}/catalog`, { method: "GET", headers });
}

function catalogContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function readCatalog(actor: string | null, boothId: string): Promise<Response> {
  return catalogRoute(catalogRequest(actor, boothId), catalogContext(boothId));
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser(SELLER.uid, SELLER.name);
  await makeUser(OUTSIDER.uid, OUTSIDER.name);
  cookies[SELLER.uid] = await mintSessionCookie(SELLER.uid);
  cookies[OUTSIDER.uid] = await mintSessionCookie(OUTSIDER.uid);

  await makeBooth(BOOTH_ID, "approved");
  await makeBooth(PENDING_BOOTH_ID, "pending");
  await makeBooth(DEACTIVATED_BOOTH_ID, "deactivated");
  await membersCol(GHOST_BOOTH_ID)
    .doc(SELLER.uid)
    .set({ uid: SELLER.uid, displayName: SELLER.name, joinedAt: Timestamp.now() });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(["users", "rateLimits"].map((name) => db.recursiveDelete(db.collection(name))));
  await db.recursiveDelete(db.collection("booths"));
  await getAdminAuth()
    .deleteUsers([SELLER.uid, OUTSIDER.uid])
    .catch(() => undefined);
  vi.restoreAllMocks();
});

describe("GET /api/booth/[id]/catalog", () => {
  it("serves a member the booth's sellable catalog in stored order", async () => {
    const res = await readCatalog(SELLER.uid, BOOTH_ID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as BoothDTO;
    expect(body).toEqual({
      id: BOOTH_ID,
      name: `Booth ${BOOTH_ID}`,
      description: "A booth with a menu",
      status: "approved",
      items: [
        { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
        { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false },
        { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
      ],
    });
  });

  it("omits archived items and never leaks the archived flag", async () => {
    const res = await readCatalog(SELLER.uid, BOOTH_ID);
    const body = (await res.json()) as BoothDTO;

    expect(body.items.map((item) => item.id)).not.toContain("tea");
    expect(JSON.stringify(body)).not.toContain("archived");
  });

  it("freezes the response shape a v1 façade must be able to return unchanged", async () => {
    const res = await readCatalog(SELLER.uid, BOOTH_ID);
    const body = (await res.json()) as BoothDTO;

    expect(Object.keys(body).sort()).toEqual(["description", "id", "items", "name", "status"]);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(["id", "isCustom", "name", "priceCents"]);
    }
  });

  it.each<BoothStatus>(["pending", "deactivated"])(
    "still serves a %s booth, reporting its status rather than gating on it",
    async (status) => {
      const boothId = status === "pending" ? PENDING_BOOTH_ID : DEACTIVATED_BOOTH_ID;
      const res = await readCatalog(SELLER.uid, boothId);
      expect(res.status).toBe(200);

      const body = (await res.json()) as BoothDTO;
      expect(body.status).toBe(status);
      expect(body.items.map((item) => item.id)).toEqual(["coffee", "cookie", "custom"]);
    },
  );

  it("forbids a non-member with FORBIDDEN", async () => {
    const res = await readCatalog(OUTSIDER.uid, BOOTH_ID);
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  it("requires authentication", async () => {
    const res = await readCatalog(null, BOOTH_ID);
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHORIZED");
  });

  it("answers NOT_FOUND when the membership outlives the booth document", async () => {
    const res = await readCatalog(SELLER.uid, GHOST_BOOTH_ID);
    expect(res.status).toBe(404);
    expect(await errorCode(res)).toBe("NOT_FOUND");
  });
});

describe("getBoothCatalog", () => {
  it("returns null for a booth that does not exist", async () => {
    expect(await getBoothCatalog("no-such-booth")).toBeNull();
  });
});
