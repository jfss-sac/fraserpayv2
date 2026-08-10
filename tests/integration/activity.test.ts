import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVITY_SCAN_LIMIT, getActivity } from "../../src/lib/server/activity";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const RECENT_UID = "activity-recent";
const STALE_PREFIX = "activity-stale-";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (run via emulators:exec).");
  }
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("rateLimits"));

  await db
    .collection("users")
    .doc(RECENT_UID)
    .set({ displayName: "Rhea Recent", suspended: false });

  const stale = db.batch();
  for (let i = 0; i < ACTIVITY_SCAN_LIMIT; i++) {
    stale.set(db.collection("rateLimits").doc(`stale_${i}`), {
      uid: `${STALE_PREFIX}${i}`,
      scope: "reads",
      count: 999,
      windowStart: Timestamp.fromMillis(NOW - 30 * HOUR),
      expiresAt: Timestamp.fromMillis(NOW + HOUR),
    });
  }
  await stale.commit();

  await db
    .collection("rateLimits")
    .doc("recent")
    .set({
      uid: RECENT_UID,
      scope: "charge",
      count: 900,
      windowStart: Timestamp.fromMillis(NOW - 5 * 60_000),
      expiresAt: Timestamp.fromMillis(NOW + 25 * HOUR),
    });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("rateLimits"));
  await db.collection("users").doc(RECENT_UID).delete();
});

describe("getActivity", () => {
  it("keeps recent activity visible when stale windows outrank it on count", async () => {
    const dto = await getActivity(NOW);

    expect(dto.actors.map((a) => a.uid)).toContain(RECENT_UID);
    expect(dto.actors.some((a) => a.uid.startsWith(STALE_PREFIX))).toBe(false);
  });
});
