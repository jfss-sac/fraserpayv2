import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { csvDownloadHeaders, csvStream } from "./csv";
import { ledgerCol, type LedgerEntryDoc } from "./db";
import { torontoDate } from "./money/shared";
import { LEDGER_EXPORT_ROW_LIMIT } from "@/lib/shared/constants";

const ISO_INSTANT = z.string().datetime({ offset: true });

export const ledgerExportSchema = z
  .object({
    from: ISO_INSTANT,
    to: ISO_INSTANT,
  })
  .strict()
  .refine((value) => Date.parse(value.from) < Date.parse(value.to), {
    path: ["to"],
    message: "The export range must end after it starts.",
  });

export type LedgerExportInput = z.infer<typeof ledgerExportSchema>;

export interface LedgerExportEntry {
  id: string;
  doc: LedgerEntryDoc;
}

export interface LedgerExportResult {
  entries: LedgerExportEntry[];
  truncated: boolean;
}

export async function getLedgerExport(input: LedgerExportInput): Promise<LedgerExportResult> {
  const snapshot = await ledgerCol()
    .where("createdAt", ">=", Timestamp.fromMillis(Date.parse(input.from)))
    .where("createdAt", "<", Timestamp.fromMillis(Date.parse(input.to)))
    .orderBy("createdAt", "asc")
    .limit(LEDGER_EXPORT_ROW_LIMIT + 1)
    .get();
  const truncated = snapshot.docs.length > LEDGER_EXPORT_ROW_LIMIT;
  const docs = truncated ? snapshot.docs.slice(0, LEDGER_EXPORT_ROW_LIMIT) : snapshot.docs;
  return {
    entries: docs.map((doc) => ({ id: doc.id, doc: doc.data() })),
    truncated,
  };
}

export function ledgerExportResponse(result: LedgerExportResult): Response {
  const headers = csvDownloadHeaders(`ledger-${torontoDate(new Date())}.csv`, {
    "x-export-row-count": String(result.entries.length),
    "x-export-row-limit": String(LEDGER_EXPORT_ROW_LIMIT),
    "x-export-truncated": String(result.truncated),
  });
  return new Response(csvStream(ledgerExportRows(result.entries, result.truncated)), { headers });
}

const LEDGER_HEADER = [
  "timestamp",
  "type",
  "buyer name",
  "booth",
  "line items",
  "amount cents",
  "direction",
  "operator",
  "entry id",
] as const;

export function ledgerExportRows(
  entries: readonly LedgerExportEntry[],
  truncated: boolean,
): readonly (readonly unknown[])[] {
  const rows: (readonly unknown[])[] = [LEDGER_HEADER];
  rows.push(
    ...entries.map(({ id, doc }) => [
      doc.createdAt.toDate().toISOString(),
      doc.type,
      doc.studentName,
      doc.boothName ?? "",
      JSON.stringify(doc.lineItems ?? []),
      doc.amountCents,
      doc.direction,
      doc.actorName,
      id,
    ]),
  );
  if (truncated) {
    rows.push([
      "NOTICE",
      `TRUNCATED: only the first ${LEDGER_EXPORT_ROW_LIMIT} matching transactions are included. Narrow the date range for a complete export.`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  }
  return rows;
}
