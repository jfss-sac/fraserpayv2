import "server-only";
import { getEventReports } from "@/lib/server/sac-reports";
import { csvDocument, csvDownloadHeaders } from "@/lib/server/csv";
import { defineHandler } from "@/lib/server/http";
import { torontoDate } from "@/lib/server/money/shared";

export const GET = defineHandler({ role: "sacMember", rateLimit: "reads" }, async () => {
  const data = await getEventReports();
  const rows = [
    [
      "row type",
      "booth",
      "status",
      "gross cents",
      "purchase count",
      "refund count",
      "cash top-ups cents",
      "card top-ups cents",
      "top-ups cents",
      "top-up count",
      "outstanding liability cents",
    ],
    ...data.booths.map((booth) => [
      "booth",
      booth.boothName,
      booth.status,
      booth.grossCents,
      booth.purchaseCount,
      booth.refundCount,
      "",
      "",
      "",
      "",
      "",
    ]),
    [
      "totals",
      "",
      "",
      data.grossTotalCents,
      "",
      "",
      "",
      "",
      "",
      "",
      data.outstandingLiabilityCents,
    ],
    [
      "top-ups",
      "",
      "",
      "",
      "",
      "",
      data.topups.cashCents,
      data.topups.cardCents,
      data.topups.totalCents,
      data.topups.count,
      "",
    ],
  ];
  return new Response(csvDocument(rows), {
    headers: csvDownloadHeaders(`reports-${torontoDate(new Date())}.csv`),
  });
});
