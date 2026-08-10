import { describe, expect, it } from "vitest";
import { type TopupAggregate, buildEventReports } from "./sac-reports";
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

const NO_TOPUPS: TopupAggregate = { totalCents: 0, totalCount: 0, cardCents: 0 };

describe("buildEventReports", () => {
  it("orders booths by gross descending, then name, and sums the gross total (A6)", () => {
    const dto = buildEventReports({
      booths: [
        booth({ boothId: "b1", boothName: "Bake Sale", grossCents: 1500 }),
        booth({ boothId: "b2", boothName: "Ring Toss", grossCents: 4000 }),
        booth({ boothId: "b3", boothName: "Apples", grossCents: 1500 }),
      ],
      topups: NO_TOPUPS,
      balanceTotalCents: 0,
    });

    expect(dto.booths.map((b) => b.boothName)).toEqual(["Ring Toss", "Apples", "Bake Sale"]);
    expect(dto.grossTotalCents).toBe(7000);
  });

  it("derives cash as everything that was not card, so no top-up is dropped", () => {
    const dto = buildEventReports({
      booths: [],
      topups: { totalCents: 3750, totalCount: 4, cardCents: 2000 },
      balanceTotalCents: 0,
    });

    expect(dto.topups).toEqual({
      cashCents: 1750,
      cardCents: 2000,
      totalCents: 3750,
      count: 4,
    });
  });

  it("reports zeroes rather than NaN when no top-ups exist", () => {
    const dto = buildEventReports({ booths: [], topups: NO_TOPUPS, balanceTotalCents: 0 });
    expect(dto.topups).toEqual({ cashCents: 0, cardCents: 0, totalCents: 0, count: 0 });
  });

  it("keeps cash and card summing to the reported total", () => {
    const dto = buildEventReports({
      booths: [],
      topups: { totalCents: 9999, totalCount: 7, cardCents: 4321 },
      balanceTotalCents: 0,
    });
    expect(dto.topups.cashCents + dto.topups.cardCents).toBe(dto.topups.totalCents);
  });

  it("passes the summed balances through as outstanding liability", () => {
    const dto = buildEventReports({ booths: [], topups: NO_TOPUPS, balanceTotalCents: 123456 });
    expect(dto.outstandingLiabilityCents).toBe(123456);
  });

  it("does not mutate the caller's booth array while sorting", () => {
    const booths = [
      booth({ boothId: "b1", grossCents: 100 }),
      booth({ boothId: "b2", grossCents: 900 }),
    ];
    buildEventReports({ booths, topups: NO_TOPUPS, balanceTotalCents: 0 });
    expect(booths.map((b) => b.boothId)).toEqual(["b1", "b2"]);
  });
});
