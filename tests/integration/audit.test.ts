import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as auditModule from "../../src/lib/server/audit";
import { writeAudit } from "../../src/lib/server/audit";
import { type AuditLogDoc, auditCol } from "../../src/lib/server/db";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";

const actor = { uid: "exec1", displayName: "Riley Kim" };
const boothTarget = { type: "booth" as const, id: "b2", label: "Pizza Palace" };

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (run via emulators:exec).");
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("auditLog"));
});

describe("writeAudit", () => {
  it("appends an entry inside a transaction with the §8.1 shape", async () => {
    const db = getAdminFirestore();
    const before = Timestamp.now();
    let id = "";
    await db.runTransaction(async (t) => {
      id = writeAudit(t, "booth.approve", actor, boothTarget, { joinCode: "PIZZA-9K1" }).id;
    });

    const read = (await auditCol().doc(id).get()).data();
    expect(read).toMatchObject({
      action: "booth.approve",
      actorUid: "exec1",
      actorName: "Riley Kim",
      targetType: "booth",
      targetId: "b2",
      targetLabel: "Pizza Palace",
      details: { joinCode: "PIZZA-9K1" },
    });
    expect(read?.createdAt).toBeInstanceOf(Timestamp);
    expect(read!.createdAt.toMillis()).toBeGreaterThanOrEqual(before.toMillis());
  });

  it("appends an entry via a WriteBatch and defaults details to an empty object", async () => {
    const db = getAdminFirestore();
    const batch = db.batch();
    const ref = writeAudit(batch, "user.suspend", actor, {
      type: "user",
      id: "u1",
      label: "Ava Nguyen",
    });
    await batch.commit();

    const read = (await auditCol().doc(ref.id).get()).data();
    expect(read?.action).toBe("user.suspend");
    expect(read?.targetType).toBe("user");
    expect(read?.details).toEqual({});
  });

  it("never overwrites: each call appends a distinct entry", async () => {
    const db = getAdminFirestore();
    const before = (await auditCol().get()).size;
    await db.runTransaction(async (t) => {
      writeAudit(t, "booth.codeRotate", actor, boothTarget);
      writeAudit(t, "booth.deactivate", actor, boothTarget);
    });
    expect((await auditCol().get()).size).toBe(before + 2);
  });

  it("exposes no update or delete API (append-only convention)", () => {
    expect(Object.keys(auditModule)).toEqual(["writeAudit"]);
  });

  it("relies on create semantics, so a colliding id is rejected at the write layer", async () => {
    const ref = auditCol().doc("fixed-id");
    const entry: AuditLogDoc = {
      action: "booth.approve",
      actorUid: actor.uid,
      actorName: actor.displayName,
      targetType: boothTarget.type,
      targetId: boothTarget.id,
      targetLabel: boothTarget.label,
      details: {},
      createdAt: Timestamp.now(),
    };
    await ref.create(entry);
    await expect(ref.create(entry)).rejects.toThrow();
  });
});
