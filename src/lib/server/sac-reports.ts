import "server-only";
import { getBoothSummary } from "./dal";
import { boothsCol, ledgerCol, usersCol } from "./db";
import type { BoothSummary, PaymentMethod, ReportsDTO } from "@/lib/shared/types";

export interface EventReportsInput {
  booths: BoothSummary[];
  topups: { method?: PaymentMethod; amountCents: number }[];
  balanceTotalCents: number;
}

export function buildEventReports(input: EventReportsInput): ReportsDTO {
  const booths = [...input.booths].sort(
    (a, b) => b.grossCents - a.grossCents || a.boothName.localeCompare(b.boothName),
  );
  const grossTotalCents = booths.reduce((sum, b) => sum + b.grossCents, 0);

  let cashCents = 0;
  let cardCents = 0;
  for (const t of input.topups) {
    if (t.method === "card") cardCents += t.amountCents;
    else cashCents += t.amountCents;
  }

  return {
    booths,
    grossTotalCents,
    topups: {
      cashCents,
      cardCents,
      totalCents: cashCents + cardCents,
      count: input.topups.length,
    },
    outstandingLiabilityCents: input.balanceTotalCents,
  };
}

export async function getEventReports(): Promise<ReportsDTO> {
  const boothSnap = await boothsCol().get();
  const reportable = boothSnap.docs.filter((d) => d.data().status !== "pending");

  const [summaries, topupSnap, userSnap] = await Promise.all([
    Promise.all(reportable.map((d) => getBoothSummary(d.id))),
    ledgerCol().where("type", "==", "topup").get(),
    usersCol().get(),
  ]);

  const booths = summaries.filter((s): s is BoothSummary => s !== null);
  const topups = topupSnap.docs.map((d) => ({
    method: d.data().method,
    amountCents: d.data().amountCents,
  }));
  const balanceTotalCents = userSnap.docs.reduce((sum, d) => sum + d.data().balanceCents, 0);

  return buildEventReports({ booths, topups, balanceTotalCents });
}
