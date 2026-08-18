import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  BOOTH_DRAFT_VERSION,
  boothDraftStorageKey,
  clearBoothDraft,
  emptyBoothDraft,
  isEmptyBoothDraft,
  loadBoothDraft,
  normalizeBoothDraft,
  saveBoothDraft,
} from "./booth-draft";

const UID = "teacher-1";

const DRAFT = {
  name: "Taco Stand",
  description: "Fresh tacos",
  items: [{ name: "Taco", price: "2.50" }],
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

test("saves and loads a versioned draft under the user's key", () => {
  expect(saveBoothDraft(UID, DRAFT)).toBe("available");
  expect(loadBoothDraft(UID)).toEqual({ status: "available", draft: DRAFT });
  expect(JSON.parse(localStorage.getItem(boothDraftStorageKey(UID)) ?? "{}")).toEqual({
    version: BOOTH_DRAFT_VERSION,
    draft: DRAFT,
  });
});

test("does not share a draft between users", () => {
  saveBoothDraft(UID, DRAFT);

  expect(loadBoothDraft("teacher-2")).toEqual({ status: "empty" });
});

test("normalizes the v2 fields and drops unrelated fields", () => {
  expect(
    normalizeBoothDraft({
      ...DRAFT,
      eventDate: "2026-08-16",
      items: [{ ...DRAFT.items[0], id: "legacy-item", category: "food" }],
    }),
  ).toEqual(DRAFT);
  expect(normalizeBoothDraft({ name: "Taco Stand", description: "Fresh tacos" })).toBeNull();
});

test("a version mismatch is discarded instead of being parsed", () => {
  localStorage.setItem(
    boothDraftStorageKey(UID),
    JSON.stringify({ version: BOOTH_DRAFT_VERSION + 1, draft: DRAFT }),
  );

  expect(loadBoothDraft(UID)).toEqual({ status: "empty" });
  expect(localStorage.getItem(boothDraftStorageKey(UID))).toBeNull();
});

test("saving an empty draft removes the stored key", () => {
  saveBoothDraft(UID, DRAFT);

  expect(saveBoothDraft(UID, emptyBoothDraft())).toBe("available");
  expect(isEmptyBoothDraft(emptyBoothDraft())).toBe(true);
  expect(localStorage.getItem(boothDraftStorageKey(UID))).toBeNull();
});

test("storage failures return blocked without breaking the caller", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  expect(saveBoothDraft(UID, DRAFT)).toBe("blocked");

  vi.restoreAllMocks();
  localStorage.setItem(
    boothDraftStorageKey(UID),
    JSON.stringify({ version: BOOTH_DRAFT_VERSION, draft: DRAFT }),
  );
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  expect(loadBoothDraft(UID)).toEqual({ status: "blocked" });
  expect(clearBoothDraft(UID)).toBe("available");
});
