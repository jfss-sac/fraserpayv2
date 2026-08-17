import "server-only";
import { writeAudit } from "@/lib/server/audit";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { defineHandler } from "@/lib/server/http";
import {
  getLedgerExport,
  ledgerExportResponse,
  ledgerExportSchema,
} from "@/lib/server/ledger-export";
import { LEDGER_EXPORT_ROW_LIMIT } from "@/lib/shared/constants";

export const POST = defineHandler(
  { role: "sacExec", schema: ledgerExportSchema, rateLimit: "exec-mutations" },
  async ({ input, authorization }) => {
    const result = await getLedgerExport(input);
    await runAuthorizedTransaction(authorization, async (transaction, actor) => {
      writeAudit(
        transaction,
        "data.export",
        actor,
        { type: "export", id: "ledger", label: "Ledger export" },
        {
          from: input.from,
          to: input.to,
          rowCount: result.entries.length,
          rowLimit: LEDGER_EXPORT_ROW_LIMIT,
          truncated: result.truncated,
        },
      );
    });

    return ledgerExportResponse(result);
  },
);
