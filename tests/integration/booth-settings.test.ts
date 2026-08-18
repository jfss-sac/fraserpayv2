import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBoothSettings } from "../../src/lib/server/dal";
import { boothsCol, membersCol } from "../../src/lib/server/db";
import { getAdminFirestore } from "../../src/lib/server/firebase-admin";
import type { BoothItem, BoothSettingsDTO } from "../../src/lib/shared/types";

const BOOTH_ID = "settings-booth";
const JOIN_CODE = "SETT-4F2K9";
const SUBMITTER_EMAIL = "teacher@pdsb.net";

const ITEMS: BoothItem[] = [
  { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
  { id: "tea", name: "Tea", priceCents: 200, isCustom: false, archived: true },
  { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false },
  { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
];

const MEMBERS = [
  { uid: "settings-seller-2", displayName: "Zoe Zeller" },
  { uid: "settings-seller-1", displayName: "Ada Adler" },
];

async function readSettings(): Promise<BoothSettingsDTO> {
  const settings = await getBoothSettings(BOOTH_ID);
  if (!settings) throw new Error("expected settings for the seeded booth");
  return settings;
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Integration test requires the firestore emulator (emulators:exec).");
  }

  await boothsCol()
    .doc(BOOTH_ID)
    .set({
      name: "Settings Booth",
      nameLower: "settings booth",
      description: "A booth with a menu",
      status: "approved",
      items: ITEMS.map((item) => ({ ...item })),
      joinCode: JOIN_CODE,
      submitterUid: "settings-teacher",
      submitterEmail: SUBMITTER_EMAIL,
      createdAt: Timestamp.now(),
    });
  for (const member of MEMBERS) {
    await membersCol(BOOTH_ID)
      .doc(member.uid)
      .set({ ...member, joinedAt: Timestamp.now() });
  }
});

afterAll(async () => {
  const db = getAdminFirestore();
  await db.recursiveDelete(db.collection("booths"));
});

describe("getBoothSettings", () => {
  it("splits the menu into what is sold now and what no longer is", async () => {
    const settings = await readSettings();

    expect(settings.items).toEqual([
      { id: "coffee", name: "Coffee", priceCents: 250, isCustom: false },
      { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false },
      { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
    ]);
    expect(settings.archivedItems).toEqual([
      { id: "tea", name: "Tea", priceCents: 200, isCustom: false },
    ]);
  });

  it("reports the booth's own name, description and status", async () => {
    const settings = await readSettings();

    expect(settings.id).toBe(BOOTH_ID);
    expect(settings.name).toBe("Settings Booth");
    expect(settings.description).toBe("A booth with a menu");
    expect(settings.status).toBe("approved");
  });

  it("lists the members by name alone, in alphabetical order", async () => {
    const settings = await readSettings();

    expect(settings.memberNames).toEqual(["Ada Adler", "Zoe Zeller"]);
    expect(JSON.stringify(settings)).not.toContain("settings-seller-1");
    expect(JSON.stringify(settings)).not.toContain("@");
  });

  it("carries no join code and no submitter email — decision 9", async () => {
    const settings = await readSettings();
    const serialized = JSON.stringify(settings);

    expect(serialized).not.toContain(JOIN_CODE);
    expect(serialized).not.toContain("joinCode");
    expect(serialized).not.toContain(SUBMITTER_EMAIL);
    expect(Object.keys(settings).sort()).toEqual([
      "archivedItems",
      "description",
      "id",
      "items",
      "memberNames",
      "name",
      "status",
    ]);
  });

  it("never leaks the archived flag on either list", async () => {
    const settings = await readSettings();

    expect(JSON.stringify(settings)).not.toContain('"archived"');
    for (const item of [...settings.items, ...settings.archivedItems]) {
      expect(Object.keys(item).sort()).toEqual(["id", "isCustom", "name", "priceCents"]);
    }
  });

  it("returns null for a booth that does not exist", async () => {
    expect(await getBoothSettings("no-such-booth")).toBeNull();
  });
});
