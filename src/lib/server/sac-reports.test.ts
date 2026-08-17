import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoothReportRow } from "@/lib/shared/types";

const { boothsGet, boothsAggGet, ledgerAggGet, usersAggGet, getTotals, getSummary, cacheCall } =
  vi.hoisted(() => ({
    boothsGet: vi.fn(),
    boothsAggGet: vi.fn(),
    ledgerAggGet: vi.fn(),
    usersAggGet: vi.fn(),
    getTotals: vi.fn(),
    getSummary: vi.fn(),
    cacheCall: {
      records: [] as { keys: string[]; opts: { revalidate?: number; tags?: string[] } }[],
    },
  }));

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    keys: string[],
    opts: { revalidate?: number; tags?: string[] },
  ) => {
    cacheCall.records.push({ keys, opts });
    let cached: unknown;
    let filled = false;
    return async (...args: unknown[]) => {
      if (!filled) {
        cached = await fn(...args);
        filled = true;
      }
      return cached;
    };
  },
}));

function ledgerQuery(filters: [string, unknown][] = []) {
  return {
    where: (field: string, _operator: string, value: unknown) =>
      ledgerQuery([...filters, [field, value]]),
    aggregate: (spec: Record<string, unknown>) => ({
      get: () => ledgerAggGet(filters, spec),
    }),
  };
}

function boothQuery(filters: [string, unknown][] = []) {
  return {
    where: (field: string, _operator: string, value: unknown) =>
      boothQuery([...filters, [field, value]]),
    aggregate: (spec: Record<string, unknown>) => ({
      get: () => boothsAggGet(filters, spec),
    }),
  };
}

vi.mock("./db", () => ({
  boothsCol: () => ({ get: boothsGet, where: boothQuery().where }),
  ledgerCol: () => ledgerQuery(),
  usersCol: () => ({
    aggregate: (spec: Record<string, unknown>) => ({ get: () => usersAggGet(spec) }),
  }),
}));

vi.mock("./dal", () => ({ getBoothLedgerTotals: getTotals, getBoothSummary: getSummary }));

import {
  REPORTS_CACHE_TAG,
  type TopupAggregate,
  buildEventReports,
  getAdminKpis,
  getCachedAdminKpis,
  getCachedEventReports,
  getEventReports,
} from "./sac-reports";

function booth(overrides: Partial<BoothReportRow> & { boothId: string }): BoothReportRow {
  return {
    boothName: overrides.boothId,
    status: "approved",
    grossCents: 0,
    purchaseCount: 0,
    refundCount: 0,
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

describe("getEventReports — read cost", () => {
  beforeEach(() => {
    boothsGet.mockReset();
    boothsAggGet.mockReset();
    ledgerAggGet.mockReset();
    usersAggGet.mockReset();
    getTotals.mockReset();
    getSummary.mockReset();
    usersAggGet.mockImplementation((spec: Record<string, unknown>) =>
      spec.total
        ? Promise.resolve({ data: () => ({ total: 4200 }) })
        : Promise.resolve({ data: () => ({ count: 0 }) }),
    );
    ledgerAggGet.mockImplementation(async (filters: [string, unknown][]) => {
      const method = filters.find(([field]) => field === "method")?.[1];
      if (method === "card") return { data: () => ({ cents: 2000, n: 1 }) };
      return { data: () => ({ cents: 3500, n: 3 }) };
    });
    getTotals.mockImplementation(async (id: string) =>
      id === "deactivated"
        ? { grossCents: 600, purchaseCount: 1, refundCount: 0 }
        : { grossCents: 1000, purchaseCount: 2, refundCount: 1 },
    );
    boothsGet.mockResolvedValue({
      docs: [
        { id: "approved", data: () => ({ status: "approved", name: "Ring Toss" }) },
        { id: "deactivated", data: () => ({ status: "deactivated", name: "Bake Sale" }) },
        { id: "pending", data: () => ({ status: "pending", name: "Soon" }) },
      ],
    });
  });

  it("never scans the ledger — booth rows come from aggregations only", async () => {
    await getEventReports();

    expect(getSummary).not.toHaveBeenCalled();
    expect(getTotals).toHaveBeenCalledTimes(2);
    expect(getTotals).toHaveBeenCalledWith("approved");
    expect(getTotals).toHaveBeenCalledWith("deactivated");
    expect(getTotals).not.toHaveBeenCalledWith("pending");
  });

  it("ships no per-item breakdown in the reports payload", async () => {
    const dto = await getEventReports();

    expect(Object.keys(dto.booths[0]).sort()).toEqual([
      "boothId",
      "boothName",
      "grossCents",
      "purchaseCount",
      "refundCount",
      "status",
    ]);
  });

  it("reads booth names and status from the booth documents it already fetched", async () => {
    const dto = await getEventReports();

    expect(dto.booths.map((b) => [b.boothId, b.boothName, b.status])).toEqual([
      ["approved", "Ring Toss", "approved"],
      ["deactivated", "Bake Sale", "deactivated"],
    ]);
    expect(boothsGet).toHaveBeenCalledTimes(1);
  });

  it("still totals top-ups, liability and gross across the reportable booths", async () => {
    const dto = await getEventReports();

    expect(dto.grossTotalCents).toBe(1600);
    expect(dto.topups).toEqual({ cashCents: 1500, cardCents: 2000, totalCents: 3500, count: 3 });
    expect(dto.outstandingLiabilityCents).toBe(4200);
  });

  it("counts a top-up without a method as cash instead of dropping it", async () => {
    ledgerAggGet.mockImplementation(async (filters: [string, unknown][]) => {
      const method = filters.find(([field]) => field === "method")?.[1];
      if (method === "cash") return { data: () => ({ cents: 1500, n: 2 }) };
      if (method === "card") return { data: () => ({ cents: 2000, n: 1 }) };
      return { data: () => ({ cents: 3750, n: 4 }) };
    });

    const dto = await getEventReports();

    expect(dto.topups).toEqual({ cashCents: 1750, cardCents: 2000, totalCents: 3750, count: 4 });
  });

  it("starts independent top-up and liability aggregates while the booth read is pending", async () => {
    let resolveBooths!: (value: { docs: never[] }) => void;
    boothsGet.mockReturnValue(
      new Promise<{ docs: never[] }>((resolve) => {
        resolveBooths = resolve;
      }),
    );

    const reports = getEventReports();
    await Promise.resolve();

    try {
      expect(ledgerAggGet).toHaveBeenCalled();
      expect(usersAggGet).toHaveBeenCalled();
    } finally {
      resolveBooths({ docs: [] });
      await reports;
    }
  });
});

describe("getCachedEventReports", () => {
  it("is wrapped in unstable_cache with a 60s revalidate and a bustable tag", async () => {
    boothsGet.mockReset();
    boothsGet.mockResolvedValue({ docs: [] });
    usersAggGet.mockResolvedValue({ data: () => ({ total: 0 }) });
    ledgerAggGet.mockResolvedValue({ data: () => ({ cents: 0, n: 0 }) });

    expect(cacheCall.records.find((record) => record.keys[0] === REPORTS_CACHE_TAG)).toEqual({
      keys: [REPORTS_CACHE_TAG],
      opts: { revalidate: 60, tags: [REPORTS_CACHE_TAG] },
    });

    await getCachedEventReports();
    await getCachedEventReports();

    expect(boothsGet).toHaveBeenCalledTimes(1);
  });
});

function primeKpiAggregations(): void {
  boothsGet.mockReset();
  boothsAggGet.mockReset();
  ledgerAggGet.mockReset();
  usersAggGet.mockReset();
  boothsAggGet.mockResolvedValue({ data: () => ({ count: 3 }) });
  usersAggGet.mockResolvedValue({ data: () => ({ count: 17 }) });
  ledgerAggGet.mockImplementation(async (filters: [string, unknown][]) => {
    if (filters.some(([field]) => field === "createdDate")) {
      return { data: () => ({ count: 11 }) };
    }
    const type = filters.find(([field]) => field === "type")?.[1];
    return { data: () => ({ cents: type === "purchase" ? 4_500 : 700 }) };
  });
}

describe("getAdminKpis", () => {
  beforeEach(primeKpiAggregations);

  it("uses count and sum aggregations for all four figures", async () => {
    await expect(getAdminKpis("2026-08-17")).resolves.toEqual({
      transactionsToday: 11,
      activeBooths: 3,
      accounts: 17,
      grossRevenueCents: 3_800,
    });

    expect(boothsGet).not.toHaveBeenCalled();
    expect(boothsAggGet).toHaveBeenCalledTimes(1);
    expect(usersAggGet).toHaveBeenCalledTimes(1);
    expect(ledgerAggGet).toHaveBeenCalledTimes(3);
    expect(ledgerAggGet).toHaveBeenCalledWith([["createdDate", "2026-08-17"]], expect.anything());
  });
});

describe("getCachedAdminKpis", () => {
  beforeEach(primeKpiAggregations);

  it("caches the aggregation result for 60 seconds and shares the reports tag", async () => {
    expect(cacheCall.records.find((record) => record.keys[0] === "admin-kpis")).toEqual({
      keys: ["admin-kpis"],
      opts: { revalidate: 60, tags: [REPORTS_CACHE_TAG] },
    });

    await getCachedAdminKpis();
    await getCachedAdminKpis();

    expect(boothsAggGet).toHaveBeenCalledTimes(1);
    expect(usersAggGet).toHaveBeenCalledTimes(1);
    expect(ledgerAggGet).toHaveBeenCalledTimes(3);
  });
});
