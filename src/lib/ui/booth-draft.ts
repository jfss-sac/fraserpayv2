export const BOOTH_DRAFT_VERSION = 1;
export const BOOTH_DRAFT_AUTOSAVE_DEBOUNCE_MS = 500;
export const BOOTH_DRAFT_STORAGE_KEY_PREFIX = "fraserpay:booth-draft";

export interface BoothDraftItem {
  name: string;
  price: string;
}

export interface BoothDraft {
  name: string;
  description: string;
  items: BoothDraftItem[];
}

export type BoothDraftStorageStatus = "available" | "blocked";

export type BoothDraftLoadResult =
  { status: "empty" } | { status: "available"; draft: BoothDraft } | { status: "blocked" };

interface StoredBoothDraft {
  version: number;
  draft: BoothDraft;
}

function emptyItem(): BoothDraftItem {
  return { name: "", price: "" };
}

export function emptyBoothDraft(): BoothDraft {
  return { name: "", description: "", items: [emptyItem()] };
}

export function boothDraftStorageKey(uid: string): string {
  return `${BOOTH_DRAFT_STORAGE_KEY_PREFIX}:${uid}`;
}

export function normalizeBoothDraft(value: unknown): BoothDraft | null {
  if (value === null || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (typeof source.name !== "string" || typeof source.description !== "string") return null;
  if (!Array.isArray(source.items)) return null;

  const items: BoothDraftItem[] = [];
  for (const value of source.items) {
    if (value === null || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.price !== "string") return null;
    items.push({ name: item.name, price: item.price });
  }

  return {
    name: source.name,
    description: source.description,
    items: items.length ? items : [emptyItem()],
  };
}

export function isEmptyBoothDraft(draft: BoothDraft): boolean {
  return (
    draft.name.trim() === "" &&
    draft.description.trim() === "" &&
    draft.items.every((item) => item.name.trim() === "" && item.price.trim() === "")
  );
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function removeStoredDraft(storage: Storage, uid: string): BoothDraftStorageStatus {
  try {
    storage.removeItem(boothDraftStorageKey(uid));
    return "available";
  } catch {
    return "blocked";
  }
}

export function loadBoothDraft(uid: string): BoothDraftLoadResult {
  const storage = getStorage();
  if (storage === null) return { status: "blocked" };

  let raw: string | null;
  try {
    raw = storage.getItem(boothDraftStorageKey(uid));
  } catch {
    return { status: "blocked" };
  }
  if (raw === null) return { status: "empty" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return removeStoredDraft(storage, uid) === "blocked"
      ? { status: "blocked" }
      : { status: "empty" };
  }

  if (value === null || typeof value !== "object") {
    return removeStoredDraft(storage, uid) === "blocked"
      ? { status: "blocked" }
      : { status: "empty" };
  }
  const stored = value as Record<string, unknown>;
  if (stored.version !== BOOTH_DRAFT_VERSION) {
    return removeStoredDraft(storage, uid) === "blocked"
      ? { status: "blocked" }
      : { status: "empty" };
  }

  const draft = normalizeBoothDraft(stored.draft);
  if (draft === null || isEmptyBoothDraft(draft)) {
    return removeStoredDraft(storage, uid) === "blocked"
      ? { status: "blocked" }
      : { status: "empty" };
  }
  return { status: "available", draft };
}

export function saveBoothDraft(uid: string, value: BoothDraft): BoothDraftStorageStatus {
  const storage = getStorage();
  if (storage === null) return "blocked";
  const draft = normalizeBoothDraft(value);
  if (draft === null || isEmptyBoothDraft(draft)) return removeStoredDraft(storage, uid);

  const stored: StoredBoothDraft = { version: BOOTH_DRAFT_VERSION, draft };
  try {
    storage.setItem(boothDraftStorageKey(uid), JSON.stringify(stored));
    return "available";
  } catch {
    return "blocked";
  }
}

export function clearBoothDraft(uid: string): BoothDraftStorageStatus {
  const storage = getStorage();
  if (storage === null) return "blocked";
  return removeStoredDraft(storage, uid);
}
