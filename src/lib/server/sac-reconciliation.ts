import "server-only";
import { z } from "zod";
import { type LedgerEntryDoc, ledgerCol } from "./db";
import type {
  PaymentMethod,
  ReconCorrectionEntry,
  ReconMemberTotals,
  ReconTopupEntry,
  ReconciliationDTO,
} from "@/lib/shared/types";

export const reconciliationQuerySchema = z
  .object({
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    actorUid: z.string().trim().min(1).optional(),
  })
  .strict();

export type ReconciliationQuery = z.infer<typeof reconciliationQuerySchema>;

interface RawEntry {
  id: string;
  doc: LedgerEntryDoc;
}

interface MemberAccumulator {
  actorUid: string;
  actorName: string;
  cashCents: number;
  cashCount: number;
  cardCents: number;
  cardCount: number;
  topups: ReconTopupEntry[];
  corrections: ReconCorrectionEntry[];
}

function iso(doc: LedgerEntryDoc): string {
  return doc.createdAt.toDate().toISOString();
}

function ensure(members: Map<string, MemberAccumulator>, doc: LedgerEntryDoc): MemberAccumulator {
  const existing = members.get(doc.actorUid);
  if (existing) return existing;
  const created: MemberAccumulator = {
    actorUid: doc.actorUid,
    actorName: doc.actorName,
    cashCents: 0,
    cashCount: 0,
    cardCents: 0,
    cardCount: 0,
    topups: [],
    corrections: [],
  };
  members.set(doc.actorUid, created);
  return created;
}

export function buildReconciliation(
  topups: RawEntry[],
  corrections: RawEntry[],
  date: string,
): ReconciliationDTO {
  const members = new Map<string, MemberAccumulator>();

  for (const { id, doc } of topups) {
    const member = ensure(members, doc);
    const method: PaymentMethod = doc.method === "card" ? "card" : "cash";
    if (method === "card") {
      member.cardCents += doc.amountCents;
      member.cardCount += 1;
    } else {
      member.cashCents += doc.amountCents;
      member.cashCount += 1;
    }
    member.topups.push({
      id,
      createdAt: iso(doc),
      amountCents: doc.amountCents,
      method,
      studentName: doc.studentName,
      studentNumber: doc.studentNumber,
      tags: doc.tags,
    });
  }

  for (const { id, doc } of corrections) {
    const member = ensure(members, doc);
    member.corrections.push({
      id,
      createdAt: iso(doc),
      amountCents: doc.amountCents,
      direction: doc.direction,
      studentName: doc.studentName,
      studentNumber: doc.studentNumber,
      reason: doc.reason ?? null,
      originalEntryId: doc.originalEntryId ?? "",
      pointsDelta: doc.pointsDelta ?? null,
    });
  }

  const byNewest = (a: { createdAt: string }, b: { createdAt: string }): number =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

  const list: ReconMemberTotals[] = [...members.values()].map((m) => ({
    ...m,
    topups: [...m.topups].sort(byNewest),
    corrections: [...m.corrections].sort(byNewest),
  }));
  list.sort(
    (a, b) => a.actorName.localeCompare(b.actorName) || a.actorUid.localeCompare(b.actorUid),
  );

  const totals = list.reduce(
    (acc, m) => ({
      cashCents: acc.cashCents + m.cashCents,
      cardCents: acc.cardCents + m.cardCents,
      topupCount: acc.topupCount + m.topups.length,
      correctionCount: acc.correctionCount + m.corrections.length,
    }),
    { cashCents: 0, cardCents: 0, topupCount: 0, correctionCount: 0 },
  );

  return { date, members: list, totals };
}

export async function getReconciliation(input: ReconciliationQuery): Promise<ReconciliationDTO> {
  let topupQuery = ledgerCol().where("type", "==", "topup").where("createdDate", "==", input.date);
  let adjustQuery = ledgerCol()
    .where("type", "==", "adjustment")
    .where("createdDate", "==", input.date);

  if (input.actorUid) {
    topupQuery = topupQuery.where("actorUid", "==", input.actorUid);
    adjustQuery = adjustQuery.where("actorUid", "==", input.actorUid);
  }

  const [topupSnap, adjustSnap] = await Promise.all([topupQuery.get(), adjustQuery.get()]);

  const topups: RawEntry[] = topupSnap.docs.map((d) => ({ id: d.id, doc: d.data() }));
  const corrections: RawEntry[] = adjustSnap.docs
    .map((d) => ({ id: d.id, doc: d.data() }))
    .filter((e) => e.doc.originalEntryId !== undefined);

  return buildReconciliation(topups, corrections, input.date);
}
