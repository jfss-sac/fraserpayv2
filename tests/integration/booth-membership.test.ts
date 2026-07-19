import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasAnyBoothMembership } from "../../src/lib/server/dal";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";

const SELLER = "bm-seller";
const OUTSIDER = "bm-outsider";
const BOOTH_A = "bm-booth-a";
const BOOTH_B = "bm-booth-b";

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (run via emulators:exec).");
  }
  const db = getAdminFirestore();
  await db
    .collection("booths")
    .doc(BOOTH_A)
    .collection("members")
    .doc(SELLER)
    .set({ uid: SELLER, displayName: SELLER });
  await db
    .collection("booths")
    .doc(BOOTH_B)
    .collection("members")
    .doc("someone-else")
    .set({ uid: "someone-else", displayName: "someone-else" });
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("booths"));
});

describe("hasAnyBoothMembership (sell-mode visibility)", () => {
  it("is true for a user who is a member of a booth", async () => {
    expect(await hasAnyBoothMembership(SELLER)).toBe(true);
  });

  it("is false for a user who belongs to no booth", async () => {
    expect(await hasAnyBoothMembership(OUTSIDER)).toBe(false);
  });
});
