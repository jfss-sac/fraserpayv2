import { afterEach, expect, test, vi } from "vitest";

const { getAdminFirestore } = vi.hoisted(() => ({ getAdminFirestore: vi.fn() }));

vi.mock("@/lib/server/firebase-admin", () => ({
  getAdminFirestore,
  getAdminAuth: vi.fn(),
}));

vi.mock("@/lib/server/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { hasAnyBoothMembership } from "@/lib/server/dal";
import { logger } from "@/lib/server/logger";

function firestoreReturning(snap: { empty: boolean }) {
  return {
    collectionGroup: () => ({
      where: () => ({ limit: () => ({ get: async () => snap }) }),
    }),
  };
}

function firestoreThrowing(err: unknown) {
  return {
    collectionGroup: () => ({
      where: () => ({
        limit: () => ({
          get: async () => {
            throw err;
          },
        }),
      }),
    }),
  };
}

afterEach(() => vi.clearAllMocks());

test("true when a membership doc exists", async () => {
  getAdminFirestore.mockReturnValue(firestoreReturning({ empty: false }));
  expect(await hasAnyBoothMembership("bm-true")).toBe(true);
});

test("false when the member collection group is empty", async () => {
  getAdminFirestore.mockReturnValue(firestoreReturning({ empty: true }));
  expect(await hasAnyBoothMembership("bm-empty")).toBe(false);
});

test("degrades to false and logs when the query fails (e.g. missing index)", async () => {
  const err = new Error("9 FAILED_PRECONDITION: requires a COLLECTION_GROUP index");
  getAdminFirestore.mockReturnValue(firestoreThrowing(err));

  expect(await hasAnyBoothMembership("bm-error")).toBe(false);
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ event: "booth-membership-check-failed", actorUid: "bm-error", err }),
  );
});
