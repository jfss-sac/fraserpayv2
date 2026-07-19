import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type LedgerEntryDoc, idempotencyCol, ledgerCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { defineHandler } from "../../src/lib/server/http";
import {
  type IdempotencyContext,
  buildIdempotencyContext,
  runIdempotent,
} from "../../src/lib/server/idempotency";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const ACTOR_UID = "idem-member";
const ENDPOINT = "/api/sac/topup";

interface ChargeResponse {
  entryId: string;
  amountCents: number;
}

function ledgerEntry(key: string, amountCents: number): LedgerEntryDoc {
  return {
    type: "topup",
    amountCents,
    direction: "credit",
    balanceAfterCents: amountCents,
    studentUid: "student-1",
    studentNumber: "900001",
    studentName: "Test Student",
    actorUid: ACTOR_UID,
    actorName: "Test Member",
    tags: [],
    idempotencyKey: key,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    createdDate: "2026-07-19",
    method: "cash",
    pointsDelta: 0,
  };
}

function chargeOnce(ctx: IdempotencyContext, amountCents: number) {
  return runIdempotent<ChargeResponse>(ctx, async (t) => {
    const ref = ledgerCol().doc();
    t.create(ref, ledgerEntry(ctx.key, amountCents));
    return { response: { entryId: ref.id, amountCents }, ledgerEntryId: ref.id };
  });
}

function ctxFor(key: string, body: unknown): IdempotencyContext {
  const request = new Request(`${ORIGIN}${ENDPOINT}`, {
    method: "POST",
    headers: { "idempotency-key": key },
  });
  return buildIdempotencyContext({ request, actorUid: ACTOR_UID, endpoint: ENDPOINT, body });
}

async function countEntriesForKey(key: string): Promise<number> {
  return (await ledgerCol().where("idempotencyKey", "==", key).get()).size;
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

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "ledger", "idempotency"].map((name) => db.recursiveDelete(db.collection(name))),
  );
  vi.restoreAllMocks();
});

let uuidCounter = 0;
function nextKey(): string {
  uuidCounter += 1;
  const n = uuidCounter.toString(16).padStart(12, "0");
  return `f47ac10b-58cc-4372-a567-${n}`;
}

describe("runIdempotent transaction helpers", () => {
  it("replays the stored response and writes no second ledger entry", async () => {
    const key = nextKey();
    const first = await chargeOnce(ctxFor(key, { amountCents: 5000 }), 5000);
    expect(first.replayed).toBe(false);

    const second = await chargeOnce(ctxFor(key, { amountCents: 5000 }), 5000);
    expect(second.replayed).toBe(true);
    expect(second.response).toEqual(first.response);
    expect(await countEntriesForKey(key)).toBe(1);
  });

  it("rejects a same-key request with a different body (409 IDEMPOTENCY_CONFLICT)", async () => {
    const key = nextKey();
    await chargeOnce(ctxFor(key, { amountCents: 5000 }), 5000);
    await expect(chargeOnce(ctxFor(key, { amountCents: 5050 }), 5050)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    expect(await countEntriesForKey(key)).toBe(1);
  });

  it("stores the ledgerEntryId link on the idempotency record", async () => {
    const key = nextKey();
    const outcome = await chargeOnce(ctxFor(key, { amountCents: 5000 }), 5000);
    const record = (await idempotencyCol().doc(`${ACTOR_UID}_${key}`).get()).data();
    expect(record?.ledgerEntryId).toBe(outcome.response.entryId);
    expect(record?.endpoint).toBe(ENDPOINT);
    expect(record?.expiresAt.toMillis()).toBeGreaterThan(record!.createdAt.toMillis());
  });

  it("executes exactly once under a concurrent race (loop)", async () => {
    const keys = Array.from({ length: 20 }, () => nextKey());
    const pairs = await Promise.all(
      keys.map((key) => {
        const ctx = ctxFor(key, { amountCents: 5000 });
        return Promise.all([chargeOnce(ctx, 5000), chargeOnce(ctx, 5000)]);
      }),
    );

    for (let i = 0; i < keys.length; i += 1) {
      const [a, b] = pairs[i]!;
      expect(a.response).toEqual(b.response);
      expect([a.replayed, b.replayed].filter((r) => r === false)).toHaveLength(1);
      expect(await countEntriesForKey(keys[i]!)).toBe(1);
    }
  }, 60_000);
});

describe("defineHandler idempotent slot wiring", () => {
  let cookie: string;

  const chargeHandler = defineHandler(
    { role: "sacMember", schema: z.object({ amountCents: z.number() }), idempotent: true },
    async ({ input, idempotency }) => {
      const { response } = await runIdempotent<ChargeResponse>(idempotency!, async (t) => {
        const ref = ledgerCol().doc();
        t.create(ref, ledgerEntry(idempotency!.key, input.amountCents));
        return {
          response: { entryId: ref.id, amountCents: input.amountCents },
          ledgerEntryId: ref.id,
        };
      });
      return { entryId: response.entryId, amountCents: response.amountCents };
    },
  );

  function post(key: string | undefined, body: unknown): Request {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      origin: ORIGIN,
      cookie: `${SESSION_COOKIE_NAME}=${cookie}`,
    };
    if (key !== undefined) headers["idempotency-key"] = key;
    return new Request(`${ORIGIN}${ENDPOINT}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    await usersCol()
      .doc(ACTOR_UID)
      .set({
        email: "900003@pdsb.net",
        displayName: "Test Member",
        displayNameLower: "test member",
        studentNumber: "900003",
        paymentCode: "fp1-IDEM01",
        balanceCents: 0,
        points: 0,
        roles: { sacMember: true, sacExec: false },
        suspended: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    cookie = await mintSessionCookie(ACTOR_UID);
  });

  it("replays through the wrapper without a second execution", async () => {
    const key = nextKey();
    const first = (await (
      await chargeHandler(post(key, { amountCents: 5000 }))
    ).json()) as ChargeResponse;
    const second = (await (
      await chargeHandler(post(key, { amountCents: 5000 }))
    ).json()) as ChargeResponse;
    expect(second).toEqual(first);
    expect(await countEntriesForKey(key)).toBe(1);
  });

  it("rejects a missing key with VALIDATION", async () => {
    const res = await chargeHandler(post(undefined, { amountCents: 5000 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
  });

  it("rejects a non-UUID key with VALIDATION", async () => {
    const res = await chargeHandler(post("not-a-uuid", { amountCents: 5000 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
  });

  it("rejects a same-key different-body replay with 409 IDEMPOTENCY_CONFLICT", async () => {
    const key = nextKey();
    await chargeHandler(post(key, { amountCents: 5000 }));
    const res = await chargeHandler(post(key, { amountCents: 5050 }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
  });
});
