import "server-only";
import { csvDocument, csvDownloadHeaders } from "@/lib/server/csv";
import { defineHandler } from "@/lib/server/http";
import { getReconciliation, reconciliationQuerySchema } from "@/lib/server/sac-reconciliation";

export const GET = defineHandler(
  { role: "sacMember", schema: reconciliationQuerySchema, rateLimit: "reads" },
  async ({ input }) => {
    const data = await getReconciliation(input);
    const rows = [
      [
        "row type",
        "date",
        "actor uid",
        "actor name",
        "cash cents",
        "cash count",
        "card cents",
        "card count",
        "top-up count",
        "correction count",
        "total cents",
      ],
      ...data.members.map((member) => [
        "member",
        data.date,
        member.actorUid,
        member.actorName,
        member.cashCents,
        member.cashCount,
        member.cardCents,
        member.cardCount,
        member.topups.length,
        member.corrections.length,
        member.cashCents + member.cardCents,
      ]),
      [
        "totals",
        data.date,
        "",
        "",
        data.totals.cashCents,
        "",
        data.totals.cardCents,
        "",
        data.totals.topupCount,
        data.totals.correctionCount,
        data.totals.cashCents + data.totals.cardCents,
      ],
    ];
    return new Response(csvDocument(rows), {
      headers: csvDownloadHeaders(`reconciliation-${data.date}.csv`),
    });
  },
);
