import "server-only";
import { type LedgerEntryDoc, ledgerCol } from "@/lib/server/db";
import { defineHandler } from "@/lib/server/http";
import type { WalletDTO, WalletHistoryEntry } from "@/lib/shared/types";

const HISTORY_LIMIT = 20;

function toHistoryEntry(id: string, doc: LedgerEntryDoc): WalletHistoryEntry {
  return {
    id,
    type: doc.type,
    direction: doc.direction,
    amountCents: doc.amountCents,
    balanceAfterCents: doc.balanceAfterCents,
    createdAt: doc.createdAt.toDate().toISOString(),
    tags: doc.tags,
    ...(doc.boothName !== undefined ? { boothName: doc.boothName } : {}),
    ...(doc.method !== undefined ? { method: doc.method } : {}),
    ...(doc.lineItems !== undefined ? { lineItems: doc.lineItems } : {}),
    ...(doc.reason !== undefined ? { reason: doc.reason } : {}),
  };
}

export const GET = defineHandler({ role: "session", rateLimit: "reads" }, async ({ session }) => {
  const snap = await ledgerCol()
    .where("studentUid", "==", session!.uid)
    .orderBy("createdAt", "desc")
    .limit(HISTORY_LIMIT)
    .get();

  const body: WalletDTO = {
    balanceCents: session!.balanceCents,
    points: session!.points,
    asOf: new Date().toISOString(),
    history: snap.docs.map((d) => toHistoryEntry(d.id, d.data())),
  };

  return Response.json(body, { headers: { "cache-control": "no-store" } });
});
