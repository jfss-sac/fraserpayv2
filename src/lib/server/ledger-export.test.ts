import { describe, expect, it, vi } from "vitest";
import type { LedgerEntryDoc } from "./db";
import { csvDocument } from "./csv";
import {
  getLedgerExport,
  ledgerExportResponse,
  ledgerExportRows,
  ledgerExportSchema,
} from "./ledger-export";
import { LEDGER_EXPORT_ROW_LIMIT } from "@/lib/shared/constants";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

function query() {
  return {
    where: () => query(),
    orderBy: () => query(),
    limit: () => ({ get }),
  };
}

vi.mock("./db", () => ({ ledgerCol: () => query() }));

function makeDoc(index: number): LedgerEntryDoc {
  return {
    type: "purchase",
    amountCents: 500,
    direction: "debit",
    balanceAfterCents: 0,
    studentUid: "student",
    studentNumber: "700001",
    studentName: "Student",
    actorUid: "operator",
    actorName: "Operator",
    tags: [],
    idempotencyKey: `key-${index}`,
    createdAt: { toDate: () => new Date(index) } as LedgerEntryDoc["createdAt"],
    createdDate: "2024-01-15",
    boothName: "Booth",
    lineItems: [{ itemId: "item", name: "Item", qty: 1, unitPriceCents: 500 }],
  };
}

describe("ledger export", () => {
  it("requires an ordered, non-empty ISO instant range", () => {
    expect(ledgerExportSchema.safeParse({ from: "2024-01-15", to: "2024-01-16" }).success).toBe(
      false,
    );
    expect(
      ledgerExportSchema.safeParse({
        from: "2024-01-16T00:00:00.000Z",
        to: "2024-01-15T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("detects one extra row without returning it past the hard cap", async () => {
    get.mockResolvedValueOnce({
      docs: Array.from({ length: LEDGER_EXPORT_ROW_LIMIT + 1 }, (_, index) => ({
        id: `entry-${index}`,
        data: () => makeDoc(index),
      })),
    });

    const result = await getLedgerExport({
      from: "2024-01-15T00:00:00.000Z",
      to: "2024-01-16T00:00:00.000Z",
    });

    expect(result.entries).toHaveLength(LEDGER_EXPORT_ROW_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("adds a spreadsheet-visible truncation notice", () => {
    const csv = csvDocument(ledgerExportRows([{ id: "entry-1", doc: makeDoc(1) }], true));
    expect(csv).toContain("TRUNCATED");
    expect(csv).toContain(String(LEDGER_EXPORT_ROW_LIMIT));
  });

  it("reports truncation in the streamed response metadata", async () => {
    const response = ledgerExportResponse({
      entries: [{ id: "entry-1", doc: makeDoc(1) }],
      truncated: true,
    });

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-export-truncated")).toBe("true");
    expect(response.headers.get("x-export-row-count")).toBe("1");
    expect(await response.text()).toContain("TRUNCATED");
  });
});
