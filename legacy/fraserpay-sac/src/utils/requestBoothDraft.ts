export type RequestBoothGroupType = "None" | "Club" | "Class";

export interface RequestBoothTeacherDraft {
  name: string;
  email: string;
}

export interface RequestBoothProductDraft {
  name: string;
  price: number;
  priceInput: string;
}

export interface RequestBoothDraft {
  respondentName: string;
  respondentEmail: string;
  teachers: RequestBoothTeacherDraft[];
  boothName: string;
  boothDescription: string;
  groupType: RequestBoothGroupType;
  groupInfo: string;
  sellingDates: boolean[];
  products: RequestBoothProductDraft[];
  additionalInformation: string;
}

interface RequestBoothDraftRecord {
  version: number;
  updatedAt: number;
  draft: RequestBoothDraft;
}

export type RequestBoothDraftLoadStatus =
  | "loaded"
  | "missing"
  | "blocked"
  | "invalid"
  | "version_mismatch";

export interface RequestBoothDraftLoadResult {
  status: RequestBoothDraftLoadStatus;
  draft: RequestBoothDraft;
}

export type RequestBoothDraftSaveStatus = "saved" | "cleared" | "blocked";

export interface RequestBoothDraftSaveResult {
  status: RequestBoothDraftSaveStatus;
}

export interface RequestBoothDraftStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const REQUEST_BOOTH_DRAFT_VERSION = 1;
export const REQUEST_BOOTH_DRAFT_STORAGE_PREFIX = "request-booth-draft";
export const REQUEST_BOOTH_DRAFT_SELLING_DAYS = 5;

const PROBE_STORAGE_KEY = `${REQUEST_BOOTH_DRAFT_STORAGE_PREFIX}:probe`;

const browserStorageAdapter: RequestBoothDraftStorageAdapter | null =
  typeof window !== "undefined" && window.localStorage
    ? {
        getItem: (key: string) => window.localStorage.getItem(key),
        setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
        removeItem: (key: string) => window.localStorage.removeItem(key),
      }
    : null;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const sanitizeString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const sanitizeGroupType = (value: unknown): RequestBoothGroupType => {
  return value === "Club" || value === "Class" ? value : "None";
};

const sanitizeSellingDates = (value: unknown): boolean[] => {
  const source = Array.isArray(value) ? value : [];

  return Array.from({ length: REQUEST_BOOTH_DRAFT_SELLING_DAYS }, (_, index) => Boolean(source[index]));
};

export const createEmptyRequestBoothProductDraft = (): RequestBoothProductDraft => {
  return {
    name: "",
    price: 0,
    priceInput: "",
  };
};

export const createEmptyRequestBoothDraft = (): RequestBoothDraft => {
  return {
    respondentName: "",
    respondentEmail: "",
    teachers: [],
    boothName: "",
    boothDescription: "",
    groupType: "None",
    groupInfo: "",
    sellingDates: Array.from({ length: REQUEST_BOOTH_DRAFT_SELLING_DAYS }, () => false),
    products: [createEmptyRequestBoothProductDraft()],
    additionalInformation: "",
  };
};

const normalizeTeacherDraft = (value: unknown): RequestBoothTeacherDraft | null => {
  if (!isPlainObject(value)) {
    return null;
  }

  const name = sanitizeString(value.name);
  const email = sanitizeString(value.email);

  if (!name && !email) {
    return null;
  }

  return {
    name,
    email,
  };
};

const normalizeProductDraft = (value: unknown): RequestBoothProductDraft => {
  if (!isPlainObject(value)) {
    return createEmptyRequestBoothProductDraft();
  }

  const name = sanitizeString(value.name);
  const priceInputCandidate = sanitizeString(value.priceInput);
  const priceCandidate = typeof value.price === "number" && Number.isFinite(value.price) ? value.price : Number.NaN;
  const parsedPriceInput = priceInputCandidate.trim() !== "" ? Number.parseFloat(priceInputCandidate) : Number.NaN;
  const resolvedPrice = Number.isFinite(parsedPriceInput)
    ? parsedPriceInput
    : Number.isFinite(priceCandidate)
      ? priceCandidate
      : 0;
  const resolvedPriceInput =
    priceInputCandidate ||
    (Number.isFinite(priceCandidate) && priceCandidate > 0 ? String(priceCandidate) : "");

  return {
    name,
    price: resolvedPrice,
    priceInput: resolvedPriceInput,
  };
};

export const normalizeRequestBoothDraft = (value: unknown): RequestBoothDraft => {
  const emptyDraft = createEmptyRequestBoothDraft();

  if (!isPlainObject(value)) {
    return emptyDraft;
  }

  const teachers = Array.isArray(value.teachers)
    ? value.teachers.map(normalizeTeacherDraft).filter((teacher): teacher is RequestBoothTeacherDraft => teacher !== null)
    : [];

  const products = Array.isArray(value.products) && value.products.length > 0
    ? value.products.map(normalizeProductDraft)
    : [createEmptyRequestBoothProductDraft()];

  return {
    respondentName: sanitizeString(value.respondentName),
    respondentEmail: sanitizeString(value.respondentEmail),
    teachers,
    boothName: sanitizeString(value.boothName),
    boothDescription: sanitizeString(value.boothDescription),
    groupType: sanitizeGroupType(value.groupType),
    groupInfo: sanitizeString(value.groupInfo),
    sellingDates: sanitizeSellingDates(value.sellingDates),
    products: products.length > 0 ? products : [createEmptyRequestBoothProductDraft()],
    additionalInformation: sanitizeString(value.additionalInformation),
  };
};

export const countRequestBoothSellingDates = (sellingDates: boolean[]): number => {
  return sellingDates.filter(Boolean).length;
};

export const validateRequestBoothDraft = (draft: RequestBoothDraft): boolean => {
  const normalizedDraft = normalizeRequestBoothDraft(draft);

  if (!normalizedDraft.respondentName.trim()) return false;
  if (!normalizedDraft.respondentEmail.trim()) return false;

  for (const teacher of normalizedDraft.teachers) {
    if (!teacher.name.trim()) return false;
    if (!teacher.email.trim()) return false;
  }

  if (!normalizedDraft.boothName.trim() || normalizedDraft.boothName.length < 3 || normalizedDraft.boothName.length > 30) return false;
  if (normalizedDraft.groupType === "None") return false;
  if (!normalizedDraft.groupInfo.trim()) return false;
  if (normalizedDraft.boothDescription.length > 100) return false;
  if (countRequestBoothSellingDates(normalizedDraft.sellingDates) === 0) return false;

  for (const product of normalizedDraft.products) {
    if (!product.name.trim() || product.name.length > 30) return false;
    if (product.price <= 0) return false;
  }

  return true;
};

export const hasRequestBoothDraftContent = (draft: RequestBoothDraft): boolean => {
  const normalizedDraft = normalizeRequestBoothDraft(draft);

  if (normalizedDraft.respondentName.trim()) return true;
  if (normalizedDraft.respondentEmail.trim()) return true;
  if (normalizedDraft.teachers.some((teacher) => teacher.name.trim() || teacher.email.trim())) return true;
  if (normalizedDraft.boothName.trim()) return true;
  if (normalizedDraft.boothDescription.trim()) return true;
  if (normalizedDraft.groupType !== "None") return true;
  if (normalizedDraft.groupInfo.trim()) return true;
  if (normalizedDraft.sellingDates.some(Boolean)) return true;
  if (normalizedDraft.products.some((product) => product.name.trim() || product.priceInput.trim() || product.price > 0)) return true;
  if (normalizedDraft.additionalInformation.trim()) return true;

  return false;
};

export const getRequestBoothDraftStorageKey = (ownerEmail: string): string => {
  const normalizedEmail = sanitizeString(ownerEmail).trim().toLowerCase();
  const encodedEmail = normalizedEmail ? encodeURIComponent(normalizedEmail) : "anonymous";

  return `${REQUEST_BOOTH_DRAFT_STORAGE_PREFIX}:${REQUEST_BOOTH_DRAFT_VERSION}:${encodedEmail}`;
};

export const canUseRequestBoothDraftStorage = (
  storage: RequestBoothDraftStorageAdapter | null = browserStorageAdapter
): boolean => {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(PROBE_STORAGE_KEY, "1");
    storage.removeItem(PROBE_STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
};

export const parseRequestBoothDraftRecord = (serialized: string | null): RequestBoothDraftLoadResult => {
  if (!serialized) {
    return {
      status: "missing",
      draft: createEmptyRequestBoothDraft(),
    };
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;

    if (!isPlainObject(parsed)) {
      return {
        status: "invalid",
        draft: createEmptyRequestBoothDraft(),
      };
    }

    if (typeof parsed.version !== "number" || parsed.version !== REQUEST_BOOTH_DRAFT_VERSION) {
      return {
        status: "version_mismatch",
        draft: createEmptyRequestBoothDraft(),
      };
    }

    const draftCandidate = "draft" in parsed ? parsed.draft : "data" in parsed ? parsed.data : null;

    return {
      status: "loaded",
      draft: normalizeRequestBoothDraft(draftCandidate),
    };
  } catch (error) {
    return {
      status: "invalid",
      draft: createEmptyRequestBoothDraft(),
    };
  }
};

export const loadRequestBoothDraft = (
  ownerEmail: string,
  storage: RequestBoothDraftStorageAdapter | null = browserStorageAdapter
): RequestBoothDraftLoadResult => {
  if (!storage) {
    return {
      status: "blocked",
      draft: createEmptyRequestBoothDraft(),
    };
  }

  const key = getRequestBoothDraftStorageKey(ownerEmail);

  try {
    const serializedDraft = storage.getItem(key);
    const parsed = parseRequestBoothDraftRecord(serializedDraft);

    if (parsed.status === "invalid" || parsed.status === "version_mismatch") {
      try {
        storage.removeItem(key);
      } catch (error) {
        // Ignore cleanup failures and fall back to an empty draft.
      }
    }

    return parsed;
  } catch (error) {
    return {
      status: "blocked",
      draft: createEmptyRequestBoothDraft(),
    };
  }
};

export const saveRequestBoothDraft = (
  ownerEmail: string,
  draft: RequestBoothDraft,
  storage: RequestBoothDraftStorageAdapter | null = browserStorageAdapter
): RequestBoothDraftSaveResult => {
  if (!storage) {
    return {
      status: "blocked",
    };
  }

  const key = getRequestBoothDraftStorageKey(ownerEmail);
  const normalizedDraft = normalizeRequestBoothDraft(draft);

  try {
    if (!hasRequestBoothDraftContent(normalizedDraft)) {
      storage.removeItem(key);
      return {
        status: "cleared",
      };
    }

    const record: RequestBoothDraftRecord = {
      version: REQUEST_BOOTH_DRAFT_VERSION,
      updatedAt: Date.now(),
      draft: normalizedDraft,
    };

    storage.setItem(key, JSON.stringify(record));
    return {
      status: "saved",
    };
  } catch (error) {
    return {
      status: "blocked",
    };
  }
};

export const clearRequestBoothDraft = (
  ownerEmail: string,
  storage: RequestBoothDraftStorageAdapter | null = browserStorageAdapter
): RequestBoothDraftSaveResult => {
  if (!storage) {
    return {
      status: "blocked",
    };
  }

  const key = getRequestBoothDraftStorageKey(ownerEmail);

  try {
    storage.removeItem(key);
    return {
      status: "cleared",
    };
  } catch (error) {
    return {
      status: "blocked",
    };
  }
};
