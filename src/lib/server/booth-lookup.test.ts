import { expect, it, vi } from "vitest";

vi.mock("./dal", () => ({ isBoothMember: vi.fn(async () => true) }));
vi.mock("./db", () => {
  const failingQuery = {
    where: () => failingQuery,
    orderBy: () => failingQuery,
    limit: () => failingQuery,
    get: async () => {
      throw new Error("ledger query unavailable");
    },
  };
  return {
    ledgerCol: () => failingQuery,
    usersCol: () => ({
      doc: () => ({
        get: async () => ({
          data: () => ({ displayName: "Ada Lovelace", balanceCents: 800, suspended: false }),
        }),
      }),
    }),
  };
});
vi.mock("./money/shared", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveBuyerUid: vi.fn(async () => "buyer-1"),
}));

import { lookupBuyer } from "./booth-lookup";

it("degrades to no duplicate-sale warning when the advisory ledger query fails", async () => {
  await expect(
    lookupBuyer({
      input: { boothId: "b1", buyer: { studentNumber: "123456" }, cartTotalCents: 500 },
      actorUid: "op-1",
    }),
  ).resolves.toEqual({ name: "Ada Lovelace", sufficient: true, lastPurchase: null });
});
