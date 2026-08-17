import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { ledgerCol } from "./db";
import { SuspendedError } from "./errors";
import { logger } from "./logger";
import { boothBuyerSchema, resolveBuyer } from "./money/shared";
import { firestoreDocumentIdSchema } from "@/lib/shared/document-id";
import type { LookupResult, RecentPurchase } from "@/lib/shared/types";

export const RECENT_PURCHASE_WINDOW_MS = 10 * 60 * 1000;
const RECENT_PURCHASE_SCAN_LIMIT = 25;

export const lookupSchema = z
  .object({
    boothId: firestoreDocumentIdSchema,
    buyer: boothBuyerSchema,
  })
  .strict();

export type LookupInput = z.infer<typeof lookupSchema>;

async function lastPurchaseAtBooth(
  buyerUid: string,
  boothId: string,
): Promise<RecentPurchase | null> {
  const now = Date.now();
  const cutoff = Timestamp.fromMillis(now - RECENT_PURCHASE_WINDOW_MS);
  let recent;
  try {
    recent = await ledgerCol()
      .where("studentUid", "==", buyerUid)
      .where("boothId", "==", boothId)
      .where("createdAt", ">=", cutoff)
      .orderBy("createdAt", "desc")
      .limit(RECENT_PURCHASE_SCAN_LIMIT)
      .get();
  } catch (err) {
    logger.warn({ event: "lookup_last_purchase_failed", err });
    return null;
  }

  const refundedCents = new Map<string, number>();
  for (const doc of recent.docs) {
    const entry = doc.data();
    if (entry.type === "refund" && entry.originalEntryId !== undefined) {
      const priorCents = refundedCents.get(entry.originalEntryId) ?? 0;
      refundedCents.set(entry.originalEntryId, priorCents + entry.amountCents);
    }
    if (entry.type === "purchase" && entry.boothId === boothId) {
      if ((refundedCents.get(doc.id) ?? 0) >= entry.amountCents) continue;
      return {
        amountCents: entry.amountCents,
        ageMs: Math.max(0, now - entry.createdAt.toMillis()),
      };
    }
  }
  return null;
}

export async function lookupBuyer(input: LookupInput): Promise<LookupResult> {
  const { uid: buyerUid, data: buyer } = await resolveBuyer(input.buyer);
  const lastPurchase = await lastPurchaseAtBooth(buyerUid, input.boothId);
  if (buyer.suspended) throw new SuspendedError();

  return {
    name: buyer.displayName,
    balanceCents: buyer.balanceCents,
    lastPurchase,
  };
}
