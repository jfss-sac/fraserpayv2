import { describe, expect, it } from "vitest";
import type { LedgerEntryDoc } from "./db";
import { torontoDate } from "./money/shared";
import { buildReconciliation, reconciliationQuerySchema } from "./sac-reconciliation";

type DocOverrides = Partial<LedgerEntryDoc> & { atMs: number };

function makeDoc(overrides: DocOverrides): LedgerEntryDoc {
  const { atMs, ...rest } = overrides;
  return {
    type: "topup",
    amountCents: 500,
    direction: "credit",
    balanceAfterCents: 500,
    studentUid: "s1",
    studentNumber: "700001",
    studentName: "Sam Student",
    actorUid: "member-a",
    actorName: "Ava Member",
    tags: [],
    idempotencyKey: "k",
    createdAt: { toDate: () => new Date(atMs) } as LedgerEntryDoc["createdAt"],
    createdDate: "2024-01-15",
    method: "cash",
    ...rest,
  };
}

function entry(id: string, overrides: DocOverrides) {
  return { id, doc: makeDoc(overrides) };
}

describe("torontoDate bucketing (A7)", () => {
  it("keeps 23:59 Toronto (EST) on the same day and rolls 00:01 to the next", () => {
    expect(torontoDate(new Date("2024-01-15T04:59:00Z"))).toBe("2024-01-14");
    expect(torontoDate(new Date("2024-01-15T05:01:00Z"))).toBe("2024-01-15");
  });

  it("buckets both sides of the UTC midnight boundary into the same Toronto day", () => {
    expect(torontoDate(new Date("2024-01-14T23:59:00Z"))).toBe("2024-01-14");
    expect(torontoDate(new Date("2024-01-15T00:01:00Z"))).toBe("2024-01-14");
  });

  it("honours daylight time (EDT, UTC-4) at the summer boundary", () => {
    expect(torontoDate(new Date("2024-07-15T03:59:00Z"))).toBe("2024-07-14");
    expect(torontoDate(new Date("2024-07-15T04:01:00Z"))).toBe("2024-07-15");
  });
});

describe("reconciliationQuerySchema", () => {
  it("accepts a YYYY-MM-DD date with an optional actorUid", () => {
    expect(reconciliationQuerySchema.parse({ date: "2024-01-15" })).toEqual({ date: "2024-01-15" });
    expect(reconciliationQuerySchema.parse({ date: "2024-01-15", actorUid: "x" })).toEqual({
      date: "2024-01-15",
      actorUid: "x",
    });
  });

  it("rejects malformed dates and unknown keys", () => {
    expect(reconciliationQuerySchema.safeParse({ date: "2024-1-5" }).success).toBe(false);
    expect(reconciliationQuerySchema.safeParse({ date: "2024-01-15", bogus: 1 }).success).toBe(
      false,
    );
    expect(reconciliationQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe("buildReconciliation", () => {
  it("splits a member's top-ups by method and sums cents and counts", () => {
    const dto = buildReconciliation(
      [
        entry("t1", { atMs: 3000, method: "cash", amountCents: 500 }),
        entry("t2", { atMs: 2000, method: "cash", amountCents: 1000 }),
        entry("t3", { atMs: 1000, method: "card", amountCents: 2000 }),
      ],
      [],
      "2024-01-15",
    );

    expect(dto.members).toHaveLength(1);
    const m = dto.members[0]!;
    expect(m.cashCents).toBe(1500);
    expect(m.cashCount).toBe(2);
    expect(m.cardCents).toBe(2000);
    expect(m.cardCount).toBe(1);
    expect(m.topups.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(dto.totals).toEqual({
      cashCents: 1500,
      cardCents: 2000,
      topupCount: 3,
      correctionCount: 0,
    });
  });

  it("groups distinct actors and orders members by name", () => {
    const dto = buildReconciliation(
      [
        entry("t1", { atMs: 1000, actorUid: "z", actorName: "Zoe" }),
        entry("t2", { atMs: 2000, actorUid: "a", actorName: "Amy" }),
      ],
      [],
      "2024-01-15",
    );
    expect(dto.members.map((m) => m.actorName)).toEqual(["Amy", "Zoe"]);
  });

  it("lists linked adjustments as corrections attributed to the adjusting actor", () => {
    const dto = buildReconciliation(
      [entry("t1", { atMs: 1000, actorUid: "a", actorName: "Amy" })],
      [
        entry("c1", {
          atMs: 5000,
          type: "adjustment",
          actorUid: "a",
          actorName: "Amy",
          direction: "debit",
          amountCents: 500,
          reason: "wrong amount",
          originalEntryId: "t1",
          pointsDelta: -25,
        }),
      ],
      "2024-01-15",
    );

    const m = dto.members.find((x) => x.actorUid === "a")!;
    expect(m.corrections).toHaveLength(1);
    expect(m.corrections[0]).toMatchObject({
      id: "c1",
      direction: "debit",
      amountCents: 500,
      reason: "wrong amount",
      originalEntryId: "t1",
      pointsDelta: -25,
    });
    expect(dto.totals.correctionCount).toBe(1);
    expect(dto.totals.cashCents).toBe(500);
  });

  it("surfaces a member who only made corrections that day", () => {
    const dto = buildReconciliation(
      [],
      [
        entry("c1", {
          atMs: 1000,
          type: "adjustment",
          actorUid: "exec",
          actorName: "Xander Exec",
          originalEntryId: "t9",
        }),
      ],
      "2024-01-15",
    );
    expect(dto.members).toHaveLength(1);
    expect(dto.members[0]!.cashCents).toBe(0);
    expect(dto.members[0]!.corrections).toHaveLength(1);
  });
});
