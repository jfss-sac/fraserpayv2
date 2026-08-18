import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type LedgerEntryDoc, ledgerCol } from "../db";
import { ConflictError, ValidationError } from "../errors";
import { type IdempotencyContext, type IdempotentOutcome, runIdempotent } from "../idempotency";
import { firestoreDocumentIdSchema } from "@/lib/shared/document-id";
import type { LedgerLineItem, RefundResult } from "@/lib/shared/types";
import { assertNonNegative, assertNotSelf, assertRefundable } from "./invariants";
import { readUser, torontoDate } from "./shared";

export const refundSchema = z
  .object({
    originalEntryId: firestoreDocumentIdSchema,
    reason: z.string().trim().min(1).max(280),
    lineItems: z
      .array(
        z.object({ itemId: z.string().trim().min(1), qty: z.number().int().positive() }).strict(),
      )
      .min(1)
      .optional(),
  })
  .strict();

export type RefundInput = z.infer<typeof refundSchema>;

interface OriginalLine {
  name: string;
  unitPriceCents: number;
  qty: number;
}

export async function refundPurchase(args: {
  input: RefundInput;
  idempotency: IdempotencyContext;
}): Promise<RefundResult> {
  const { input, idempotency } = args;
  const actorUid = idempotency.actorUid;
  const createdDate = torontoDate(new Date());

  const { response }: IdempotentOutcome<RefundResult> = await runIdempotent(
    idempotency,
    [],
    async (t, actor) => {
      const original = (await t.get(ledgerCol().doc(input.originalEntryId))).data();
      if (!original || original.type !== "purchase") {
        throw new ValidationError("Only a purchase can be refunded.");
      }
      assertNotSelf(
        actorUid,
        original.studentUid,
        "You can't refund your own purchase, another exec must do it.",
      );

      const prior = await t.get(ledgerCol().where("originalEntryId", "==", input.originalEntryId));

      const originalByItem = new Map<string, OriginalLine>();
      for (const li of original.lineItems ?? []) {
        const existing = originalByItem.get(li.itemId);
        if (existing) existing.qty += li.qty;
        else
          originalByItem.set(li.itemId, {
            name: li.name,
            unitPriceCents: li.unitPriceCents,
            qty: li.qty,
          });
      }

      const refundedByItem = new Map<string, number>();
      for (const doc of prior.docs) {
        const entry = doc.data();
        if (entry.type !== "refund") continue;
        for (const li of entry.lineItems ?? []) {
          refundedByItem.set(li.itemId, (refundedByItem.get(li.itemId) ?? 0) + li.qty);
        }
      }

      let refundLines: LedgerLineItem[];
      if (input.lineItems !== undefined) {
        const requestedByItem = new Map<string, number>();
        for (const { itemId, qty } of input.lineItems) {
          requestedByItem.set(itemId, (requestedByItem.get(itemId) ?? 0) + qty);
        }
        refundLines = [...requestedByItem].map(([itemId, qty]) => {
          const orig = originalByItem.get(itemId);
          if (!orig) throw new ValidationError("That item was not part of the original purchase.");
          const remaining = orig.qty - (refundedByItem.get(itemId) ?? 0);
          if (qty > remaining) {
            throw new ConflictError("Refund exceeds the remaining refundable quantity.");
          }
          return { itemId, name: orig.name, qty, unitPriceCents: orig.unitPriceCents };
        });
      } else {
        refundLines = [];
        for (const [itemId, orig] of originalByItem) {
          const remaining = orig.qty - (refundedByItem.get(itemId) ?? 0);
          if (remaining > 0) {
            refundLines.push({
              itemId,
              name: orig.name,
              qty: remaining,
              unitPriceCents: orig.unitPriceCents,
            });
          }
        }
        if (refundLines.length === 0) {
          throw new ConflictError("This purchase has already been fully refunded.");
        }
      }

      const amountCents = refundLines.reduce((sum, li) => sum + li.qty * li.unitPriceCents, 0);
      assertRefundable(amountCents);

      const { ref, data } = await readUser(t, original.studentUid);
      const balanceAfterCents = data.balanceCents + amountCents;
      assertNonNegative(balanceAfterCents);
      const now = Timestamp.now();

      const entry: LedgerEntryDoc = {
        type: "refund",
        amountCents,
        direction: "credit",
        balanceAfterCents,
        studentUid: original.studentUid,
        studentNumber: data.studentNumber,
        studentName: data.displayName,
        actorUid,
        actorName: actor.displayName,
        tags: [],
        idempotencyKey: idempotency.key,
        createdAt: now,
        createdDate,
        reason: input.reason,
        originalEntryId: input.originalEntryId,
        lineItems: refundLines,
        ...(original.boothId !== undefined ? { boothId: original.boothId } : {}),
        ...(original.boothName !== undefined ? { boothName: original.boothName } : {}),
      };

      const entryRef = ledgerCol().doc();
      t.create(entryRef, entry);
      t.update(ref, { balanceCents: balanceAfterCents, updatedAt: now });

      return {
        response: { entryId: entryRef.id, amountCents, balanceAfterCents },
        ledgerEntryId: entryRef.id,
      };
    },
  );

  return response;
}
