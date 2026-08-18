import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as chargeRoute } from "../../src/app/api/booth/charge/route";
import { POST as registerRoute } from "../../src/app/api/booths/register/route";
import { POST as rolesRoute } from "../../src/app/api/exec/roles/route";
import { POST as topupRoute } from "../../src/app/api/sac/topup/route";
import { auditCol, boothsCol, ledgerCol, membersCol, usersCol } from "../../src/lib/server/db";
import { getAdminAuth, getAdminFirestore } from "../../src/lib/server/firebase-admin";
import { IDEMPOTENT_REPLAY_HEADER } from "../../src/lib/server/idempotency";
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "../../src/lib/shared/constants";

const ORIGIN = "http://127.0.0.1";
const EXEC_UID = "authorization-race-exec";
const OPERATOR_UID = "authorization-race-operator";
const TARGET_UID = "authorization-race-target";
const BUYER_UID = "authorization-race-buyer";
const EXEC_BUYER_UID = "authorization-race-exec-buyer";
const CAP_EXEC_UID = "authorization-race-cap-exec";
const CAP_BUYER_UID = "authorization-race-cap-buyer";
const REPLAY_MEMBER_UID = "authorization-race-replay-member";
const REPLAY_BUYER_UID = "authorization-race-replay-buyer";
const NAME_MEMBER_UID = "authorization-race-name-member";
const NAME_BUYER_UID = "authorization-race-name-buyer";
const REGISTER_UID = "authorization-race-register";
const BOOTH_ID = "authorization-race-booth";

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
  roles: { sacMember: boolean; sacExec: boolean },
  balanceCents = 0,
): Promise<void> {
  await usersCol()
    .doc(uid)
    .set({
      email: `${uid}@pdsb.net`,
      displayName: uid,
      displayNameLower: uid,
      studentNumber: null,
      paymentCode: `fp1-${uid}`,
      balanceCents,
      points: 0,
      roles,
      suspended: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
}

function post(path: string, actorUid: string, body: unknown, idempotencyKey?: string): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: ORIGIN,
    cookie: `${SESSION_COOKIE_NAME}=${cookies[actorUid]}`,
  };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

async function updateRoles(
  uid: string,
  roles: { sacMember: boolean; sacExec: boolean },
): Promise<void> {
  await usersCol().doc(uid).update({ roles, updatedAt: Timestamp.now() });
}

function pauseNextTransaction(): {
  started: Promise<void>;
  release: () => void;
  restore: () => void;
} {
  const db = getAdminFirestore();
  const originalRunTransaction = db.runTransaction.bind(db);
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(db, "runTransaction").mockImplementationOnce((updateFunction) => {
    return originalRunTransaction(async (transaction) => {
      markStarted();
      await released;
      return updateFunction(transaction);
    });
  });
  return { started, release, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("Integration test requires the auth + firestore emulators (emulators:exec).");
  }
  vi.spyOn(console, "log").mockImplementation(() => {});

  await makeUser(EXEC_UID, { sacMember: true, sacExec: true });
  await makeUser(OPERATOR_UID, { sacMember: false, sacExec: false });
  await makeUser(TARGET_UID, { sacMember: false, sacExec: false });
  await makeUser(BUYER_UID, { sacMember: false, sacExec: false }, 1_000);
  await makeUser(EXEC_BUYER_UID, { sacMember: false, sacExec: false }, 1_000);
  await makeUser(CAP_EXEC_UID, { sacMember: true, sacExec: true });
  await makeUser(CAP_BUYER_UID, { sacMember: false, sacExec: false });
  await makeUser(REPLAY_MEMBER_UID, { sacMember: true, sacExec: false });
  await makeUser(REPLAY_BUYER_UID, { sacMember: false, sacExec: false });
  await makeUser(NAME_MEMBER_UID, { sacMember: true, sacExec: false });
  await makeUser(NAME_BUYER_UID, { sacMember: false, sacExec: false });
  await makeUser(REGISTER_UID, { sacMember: false, sacExec: false });
  cookies[EXEC_UID] = await mintSessionCookie(EXEC_UID);
  cookies[OPERATOR_UID] = await mintSessionCookie(OPERATOR_UID);
  cookies[CAP_EXEC_UID] = await mintSessionCookie(CAP_EXEC_UID);
  cookies[REPLAY_MEMBER_UID] = await mintSessionCookie(REPLAY_MEMBER_UID);
  cookies[NAME_MEMBER_UID] = await mintSessionCookie(NAME_MEMBER_UID);
  cookies[REGISTER_UID] = await mintSessionCookie(REGISTER_UID);

  await boothsCol()
    .doc(BOOTH_ID)
    .set({
      name: "Authorization Race Booth",
      nameLower: "authorization race booth",
      description: "test",
      status: "approved",
      items: [{ id: "item", name: "Item", priceCents: 100, isCustom: false }],
      joinCode: "RACE123",
      submitterUid: OPERATOR_UID,
      submitterEmail: `${OPERATOR_UID}@pdsb.net`,
      createdAt: Timestamp.now(),
    });
  await membersCol(BOOTH_ID)
    .doc(OPERATOR_UID)
    .set({ uid: OPERATOR_UID, displayName: OPERATOR_UID, joinedAt: Timestamp.now() });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await Promise.all(
    ["users", "booths", "ledger", "idempotency", "rateLimits", "auditLog"].map((name) =>
      db.recursiveDelete(db.collection(name)),
    ),
  );
  vi.restoreAllMocks();
});

describe("transactional authorization freshness", () => {
  it("does not commit an exec mutation after the actor's exec role is revoked", async () => {
    const gate = pauseNextTransaction();
    try {
      const pending = rolesRoute(
        post("/api/exec/roles", EXEC_UID, {
          targetUid: TARGET_UID,
          role: "sacMember",
          grant: true,
        }),
      );

      await gate.started;
      await usersCol().doc(EXEC_UID).update({ "roles.sacExec": false, updatedAt: Timestamp.now() });
      gate.release();

      const res = await pending;
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("FORBIDDEN");
      expect((await usersCol().doc(TARGET_UID).get()).data()?.roles.sacMember).toBe(false);
    } finally {
      gate.release();
      gate.restore();
    }
  });

  it("does not commit a booth charge after the operator is suspended", async () => {
    const gate = pauseNextTransaction();
    try {
      const pending = chargeRoute(
        post(
          "/api/booth/charge",
          OPERATOR_UID,
          {
            boothId: BOOTH_ID,
            buyer: { paymentCode: `fp1-${BUYER_UID}` },
            items: [{ itemId: "item", qty: 1 }],
          },
          "f47ac10b-58cc-4372-a567-000000000001",
        ),
      );

      await gate.started;
      await usersCol().doc(OPERATOR_UID).update({ suspended: true, updatedAt: Timestamp.now() });
      gate.release();

      const res = await pending;
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("SUSPENDED");
      expect((await usersCol().doc(BUYER_UID).get()).data()?.balanceCents).toBe(1_000);
      expect((await ledgerCol().where("studentUid", "==", BUYER_UID).get()).size).toBe(0);
    } finally {
      gate.release();
      gate.restore();
    }
  });

  it("does not commit a non-member exec's charge after the exec role is revoked (loop)", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await updateRoles(EXEC_UID, { sacMember: true, sacExec: true });
      const gate = pauseNextTransaction();
      try {
        const pending = chargeRoute(
          post(
            "/api/booth/charge",
            EXEC_UID,
            {
              boothId: BOOTH_ID,
              buyer: { paymentCode: `fp1-${EXEC_BUYER_UID}` },
              items: [{ itemId: "item", qty: 1 }],
            },
            `f47ac10b-58cc-4372-a567-1000000000${attempt.toString().padStart(2, "0")}`,
          ),
        );

        await gate.started;
        await updateRoles(EXEC_UID, { sacMember: true, sacExec: false });
        gate.release();

        const res = await pending;
        expect(res.status).toBe(403);
        expect(await errorCode(res)).toBe("FORBIDDEN");
        expect((await usersCol().doc(EXEC_BUYER_UID).get()).data()?.balanceCents).toBe(1_000);
        expect((await ledgerCol().where("studentUid", "==", EXEC_BUYER_UID).get()).size).toBe(0);
        expect((await auditCol().where("action", "==", "booth.execCharge").get()).size).toBe(0);
      } finally {
        gate.release();
        gate.restore();
      }
    }
    await updateRoles(EXEC_UID, { sacMember: true, sacExec: false });
  });

  it("does not use a revoked exec role for a queued top-up cap override", async () => {
    const gate = pauseNextTransaction();
    try {
      const pending = topupRoute(
        post(
          "/api/sac/topup",
          CAP_EXEC_UID,
          {
            buyer: { paymentCode: `fp1-${CAP_BUYER_UID}` },
            amountCents: 10_500,
            method: "cash",
            overrideReason: "authorized before revocation",
          },
          "f47ac10b-58cc-4372-a567-000000000002",
        ),
      );

      await gate.started;
      await updateRoles(CAP_EXEC_UID, { sacMember: true, sacExec: false });
      gate.release();

      const res = await pending;
      expect(res.status).toBe(422);
      expect(await errorCode(res)).toBe("CAP_EXCEEDED");
      expect((await usersCol().doc(CAP_BUYER_UID).get()).data()?.balanceCents).toBe(0);
      expect((await ledgerCol().where("studentUid", "==", CAP_BUYER_UID).get()).size).toBe(0);
    } finally {
      gate.release();
      gate.restore();
    }
  });

  it("returns a committed replay when the actor's role is revoked before the transaction", async () => {
    const body = {
      buyer: { paymentCode: `fp1-${REPLAY_BUYER_UID}` },
      amountCents: 500,
      method: "cash",
    };

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await updateRoles(REPLAY_MEMBER_UID, { sacMember: true, sacExec: false });
      const key = `f47ac10b-58cc-4372-a567-${attempt.toString().padStart(12, "0")}`;
      const first = await topupRoute(post("/api/sac/topup", REPLAY_MEMBER_UID, body, key));
      expect(first.status).toBe(200);
      const firstBody = await first.json();

      const gate = pauseNextTransaction();
      try {
        const pendingReplay = topupRoute(post("/api/sac/topup", REPLAY_MEMBER_UID, body, key));

        await gate.started;
        await updateRoles(REPLAY_MEMBER_UID, { sacMember: false, sacExec: false });
        gate.release();

        const replay = await pendingReplay;
        expect(replay.status).toBe(200);
        expect(replay.headers.get(IDEMPOTENT_REPLAY_HEADER)).toBe("true");
        expect(await replay.json()).toEqual(firstBody);
      } finally {
        gate.release();
        gate.restore();
      }
    }

    expect((await usersCol().doc(REPLAY_BUYER_UID).get()).data()?.balanceCents).toBe(1_500);
    expect((await ledgerCol().where("studentUid", "==", REPLAY_BUYER_UID).get()).size).toBe(3);
  });

  it("attributes the ledger entry to the actor document the transaction authorized", async () => {
    const gate = pauseNextTransaction();
    try {
      const pending = topupRoute(
        post(
          "/api/sac/topup",
          NAME_MEMBER_UID,
          { buyer: { paymentCode: `fp1-${NAME_BUYER_UID}` }, amountCents: 500, method: "cash" },
          "f47ac10b-58cc-4372-a567-000000000003",
        ),
      );

      await gate.started;
      await usersCol()
        .doc(NAME_MEMBER_UID)
        .update({ displayName: "Renamed Mid Transaction", updatedAt: Timestamp.now() });
      gate.release();

      const res = await pending;
      expect(res.status).toBe(200);

      const entries = await ledgerCol().where("studentUid", "==", NAME_BUYER_UID).get();
      expect(entries.size).toBe(1);
      expect(entries.docs[0]!.data()).toMatchObject({
        actorUid: NAME_MEMBER_UID,
        actorName: "Renamed Mid Transaction",
      });
    } finally {
      gate.release();
      gate.restore();
    }
  });

  it("reports a re-registration by an actor suspended mid-request rather than replaying it", async () => {
    const body = {
      name: "Race Registration",
      description: "test",
      items: [{ name: "Item", priceCents: 100 }],
    };
    const first = await registerRoute(post("/api/booths/register", REGISTER_UID, body));
    expect(first.status).toBe(200);

    const gate = pauseNextTransaction();
    try {
      const pending = registerRoute(post("/api/booths/register", REGISTER_UID, body));

      await gate.started;
      await usersCol().doc(REGISTER_UID).update({ suspended: true, updatedAt: Timestamp.now() });
      gate.release();

      const res = await pending;
      expect(res.status).toBe(403);
      expect(await errorCode(res)).toBe("SUSPENDED");
    } finally {
      gate.release();
      gate.restore();
      await usersCol().doc(REGISTER_UID).update({ suspended: false, updatedAt: Timestamp.now() });
    }
  });
});
