import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoothSummary } from "@/lib/shared/types";

const { boothsGet, getGross, cacheCall } = vi.hoisted(() => ({
  boothsGet: vi.fn(),
  getGross: vi.fn(),
  cacheCall: { current: null as null | { keys: string[]; opts: { revalidate?: number } } },
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    keys: string[],
    opts: { revalidate?: number },
  ) => {
    cacheCall.current = { keys, opts };
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

vi.mock("./db", () => ({ boothsCol: () => ({ get: boothsGet }) }));
vi.mock("./dal", () => ({ getBoothGrossCents: getGross }));

import { buildLeaderboard, computeLeaderboard, getLeaderboard } from "./leaderboard";

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

describe("buildLeaderboard", () => {
  it("ranks booths by gross descending, breaking ties by name", () => {
    const { rows } = buildLeaderboard([
      booth({ boothId: "b1", boothName: "Bake Sale", grossCents: 1500 }),
      booth({ boothId: "b2", boothName: "Ring Toss", grossCents: 4000 }),
      booth({ boothId: "b3", boothName: "Apples", grossCents: 1500 }),
    ]);

    expect(rows).toEqual([
      { rank: 1, boothId: "b2", boothName: "Ring Toss", grossCents: 4000 },
      { rank: 2, boothId: "b3", boothName: "Apples", grossCents: 1500 },
      { rank: 3, boothId: "b1", boothName: "Bake Sale", grossCents: 1500 },
    ]);
  });

  it("exposes no per-item data", () => {
    const { rows } = buildLeaderboard([
      booth({
        boothId: "b1",
        grossCents: 500,
        items: [{ itemId: "i1", name: "Cake", qty: 2, revenueCents: 500 }],
      }),
    ]);
    expect(Object.keys(rows[0])).toEqual(["rank", "boothId", "boothName", "grossCents"]);
  });

  it("does not mutate the caller's array", () => {
    const booths = [
      booth({ boothId: "b1", grossCents: 100 }),
      booth({ boothId: "b2", grossCents: 900 }),
    ];
    buildLeaderboard(booths);
    expect(booths.map((b) => b.boothId)).toEqual(["b1", "b2"]);
  });
});

describe("computeLeaderboard", () => {
  beforeEach(() => {
    boothsGet.mockReset();
    getGross.mockReset();
  });

  it("excludes pending booths and drops missing summaries", async () => {
    boothsGet.mockResolvedValue({
      docs: [
        { id: "approved", data: () => ({ status: "approved", name: "New" }) },
        { id: "deactivated", data: () => ({ status: "deactivated", name: "Old" }) },
        { id: "pending", data: () => ({ status: "pending", name: "Soon" }) },
      ],
    });
    getGross.mockImplementation(async (id: string) => (id === "deactivated" ? 200 : 800));

    const { rows } = await computeLeaderboard();

    expect(getGross).toHaveBeenCalledTimes(2);
    expect(getGross).not.toHaveBeenCalledWith("pending");
    expect(rows.map((r) => r.boothId)).toEqual(["approved", "deactivated"]);
  });

  it("reads booth names from the booth documents without a summary round-trip", async () => {
    boothsGet.mockResolvedValue({
      docs: [{ id: "b1", data: () => ({ status: "approved", name: "Ring Toss" }) }],
    });
    getGross.mockResolvedValue(4200);

    const { rows } = await computeLeaderboard();

    expect(rows).toEqual([{ rank: 1, boothId: "b1", boothName: "Ring Toss", grossCents: 4200 }]);
  });
});

describe("getLeaderboard cache", () => {
  it("is wrapped in unstable_cache with a 900s revalidate and serves the second call from cache", async () => {
    boothsGet.mockReset();
    boothsGet.mockResolvedValue({ docs: [] });

    expect(cacheCall.current).toEqual({ keys: ["leaderboard"], opts: { revalidate: 900 } });

    await getLeaderboard();
    await getLeaderboard();

    expect(boothsGet).toHaveBeenCalledTimes(1);
  });
});
