import "server-only";
import { AggregateField } from "firebase-admin/firestore";
import { getBoothSummary } from "./dal";
import { boothsCol, ledgerCol, usersCol } from "./db";
import type { BoothSummary, ReportsDTO } from "@/lib/shared/types";

export interface TopupAggregate {
  totalCents: number;
  totalCount: number;
  cardCents: number;
}

export interface EventReportsInput {
  booths: BoothSummary[];
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

export async function getEventReports(): Promise<ReportsDTO> {
  const boothSnap = await boothsCol().get();
  const reportable = boothSnap.docs.filter((d) => d.data().status !== "pending");

  const [summaries, topups, balanceTotalCents] = await Promise.all([
    Promise.all(reportable.map((d) => getBoothSummary(d.id))),
    getTopupAggregate(),
    getOutstandingLiabilityCents(),
  ]);

  const booths = summaries.filter((s): s is BoothSummary => s !== null);

  return buildEventReports({ booths, topups, balanceTotalCents });
}
