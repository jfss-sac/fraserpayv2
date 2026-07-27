import { describe, expect, it } from "vitest";
import { buildEventReports } from "./sac-reports";
import type { BoothSummary } from "@/lib/shared/types";

function booth(overrides: Partial<BoothSummary> & { boothId: string }): BoothSummary {
  return {
    boothName: overrides.boothId,
    status: "approved",
    grossCents: 0,
    purchaseCount: 0,
    refundCount: 0,
    items: [],
    ...overrides,
  };
}

describe("buildEventReports", () => {
  it("orders booths by gross descending, then name, and sums the gross total (A6)", () => {
    const dto = buildEventReports({
      booths: [
        booth({ boothId: "b1", boothName: "Bake Sale", grossCents: 1500 }),
        booth({ boothId: "b2", boothName: "Ring Toss", grossCents: 4000 }),
        booth({ boothId: "b3", boothName: "Apples", grossCents: 1500 }),
      ],
      topups: [],
      balanceTotalCents: 0,
    });

    expect(dto.booths.map((b) => b.boothName)).toEqual(["Ring Toss", "Apples", "Bake Sale"]);
    expect(dto.grossTotalCents).toBe(7000);
  });

  it("splits top-ups by method and counts them, treating a missing method as cash", () => {
    const dto = buildEventReports({
      booths: [],
      topups: [
        { method: "cash", amountCents: 500 },
        { method: "cash", amountCents: 1000 },
        { method: "card", amountCents: 2000 },
        { amountCents: 250 },
      ],
      balanceTotalCents: 0,
    });

    expect(dto.topups).toEqual({
      cashCents: 1750,
      cardCents: 2000,
      totalCents: 3750,
      count: 4,
    });
  });

  it("passes the summed balances through as outstanding liability", () => {
    const dto = buildEventReports({ booths: [], topups: [], balanceTotalCents: 123456 });
    expect(dto.outstandingLiabilityCents).toBe(123456);
  });

  it("does not mutate the caller's booth array while sorting", () => {
    const booths = [
      booth({ boothId: "b1", grossCents: 100 }),
      booth({ boothId: "b2", grossCents: 900 }),
    ];
    buildEventReports({ booths, topups: [], balanceTotalCents: 0 });
    expect(booths.map((b) => b.boothId)).toEqual(["b1", "b2"]);
  });
});
