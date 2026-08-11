import "server-only";
import { AggregateField } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { getBoothLedgerTotals } from "./dal";
import { boothsCol, ledgerCol, usersCol } from "./db";
import type { BoothReportRow, ReportsDTO } from "@/lib/shared/types";

export const REPORTS_CACHE_TAG = "event-reports";

export interface TopupAggregate {
  totalCents: number;
  totalCount: number;
  cardCents: number;
}

export interface EventReportsInput {
  booths: BoothReportRow[];
  topups: TopupAggregate;
  balanceTotalCents: number;
}

export function buildEventReports(input: EventReportsInput): ReportsDTO {
  const booths = [...input.booths].sort(
    (a, b) => b.grossCents - a.grossCents || a.boothName.localeCompare(b.boothName),
  );
  const grossTotalCents = booths.reduce((sum, b) => sum + b.grossCents, 0);

  const { totalCents, totalCount, cardCents } = input.topups;

  return {
    booths,
    grossTotalCents,
    topups: {
      cashCents: totalCents - cardCents,
      cardCents,
      totalCents,
      count: totalCount,
    },
    outstandingLiabilityCents: input.balanceTotalCents,
  };
}

async function getTopupAggregate(): Promise<TopupAggregate> {
  const topups = ledgerCol().where("type", "==", "topup");
  const [all, card] = await Promise.all([
    topups.aggregate({ cents: AggregateField.sum("amountCents"), n: AggregateField.count() }).get(),
    topups
      .where("method", "==", "card")
      .aggregate({ cents: AggregateField.sum("amountCents") })
      .get(),
  ]);
  return {
    totalCents: all.data().cents,
    totalCount: all.data().n,
    cardCents: card.data().cents,
  };
}

async function getOutstandingLiabilityCents(): Promise<number> {
  const snap = await usersCol()
    .aggregate({ total: AggregateField.sum("balanceCents") })
    .get();
  return snap.data().total;
}

async function getBoothReportRows(): Promise<BoothReportRow[]> {
  const boothSnap = await boothsCol().get();
  const reportable = boothSnap.docs.filter((d) => d.data().status !== "pending");

  return Promise.all(
    reportable.map(async (doc) => {
      const booth = doc.data();
      return {
        boothId: doc.id,
        boothName: booth.name,
        status: booth.status,
        ...(await getBoothLedgerTotals(doc.id)),
      };
    }),
  );
}

export async function getEventReports(): Promise<ReportsDTO> {
  const [booths, topups, balanceTotalCents] = await Promise.all([
    getBoothReportRows(),
    getTopupAggregate(),
    getOutstandingLiabilityCents(),
  ]);

  return buildEventReports({ booths, topups, balanceTotalCents });
}

export const getCachedEventReports = unstable_cache(getEventReports, [REPORTS_CACHE_TAG], {
  revalidate: 60,
  tags: [REPORTS_CACHE_TAG],
});
