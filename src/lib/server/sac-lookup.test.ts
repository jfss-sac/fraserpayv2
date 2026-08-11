import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryGet, userGet, where } = vi.hoisted(() => ({
  queryGet: vi.fn(),
  userGet: vi.fn(),
  where: vi.fn(),
}));

vi.mock("./db", () => ({
  usersCol: () => ({
    where,
    doc: () => ({ get: userGet }),
  }),
}));

import { sacLookupBuyer } from "./sac-lookup";

const BUYER = {
  displayName: "Sam Student",
  balanceCents: 1250,
  points: 75,
  suspended: false,
};

const RESULT = { name: "Sam Student", balanceCents: 1250, points: 75 };

const LOOKUPS = [
  {
    label: "student-number",
    buyer: { studentNumber: "800123" },
    field: "studentNumber",
    value: "800123",
  },
  {
    label: "payment-code",
    buyer: { paymentCode: "fp1-SESSIONCODE" },
    field: "paymentCode",
    value: "fp1-SESSIONCODE",
  },
] as const;

describe("sacLookupBuyer — read cost", () => {
  beforeEach(() => {
    queryGet.mockReset();
    userGet.mockReset();
    where.mockReset();
    queryGet.mockResolvedValue({ docs: [{ id: "buyer-1", data: () => BUYER }] });
    userGet.mockResolvedValue({ data: () => BUYER });
    where.mockReturnValue({ limit: () => ({ get: queryGet }) });
  });

  it.each(LOOKUPS)(
    "reuses the $label query snapshot instead of fetching the user document again",
    async ({ buyer, field, value }) => {
      await expect(sacLookupBuyer({ buyer })).resolves.toEqual(RESULT);

      expect(where).toHaveBeenCalledWith(field, "==", value);
      expect(queryGet).toHaveBeenCalledTimes(1);
      expect(userGet).not.toHaveBeenCalled();
    },
  );
});
