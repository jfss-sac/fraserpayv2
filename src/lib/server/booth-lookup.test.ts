import { expect, it, vi } from "vitest";

const { userGet } = vi.hoisted(() => ({ userGet: vi.fn() }));

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
        get: userGet.mockResolvedValue({
          data: () => ({ displayName: "Ada Lovelace", balanceCents: 800, suspended: false }),
        }),
      }),
    }),
  };
});
vi.mock("./money/shared", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveBuyer: vi.fn(async () => ({
    uid: "buyer-1",
    data: { displayName: "Ada Lovelace", balanceCents: 800, suspended: false },
  })),
}));

import { lookupBuyer } from "./booth-lookup";

it("reuses the resolved buyer while degrading an advisory ledger failure", async () => {
  await expect(lookupBuyer({ boothId: "b1", buyer: { studentNumber: "123456" } })).resolves.toEqual(
    { name: "Ada Lovelace", balanceCents: 800, lastPurchase: null },
  );
  expect(userGet).not.toHaveBeenCalled();
});
