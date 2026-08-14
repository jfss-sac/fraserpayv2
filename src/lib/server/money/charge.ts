import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type LedgerEntryDoc, boothsCol, ledgerCol, membersCol } from "../db";
import {
  BoothNotSellableError,
  CatalogChangedError,
  ForbiddenError,
  InsufficientFundsError,
} from "../errors";
import { type IdempotencyContext, type IdempotentOutcome, runIdempotent } from "../idempotency";
import { CENT_STEP } from "@/lib/shared/constants";
import { isHighAmount } from "@/lib/shared/money";
import type { ChargeResult, LedgerLineItem } from "@/lib/shared/types";
import { assertNonNegative } from "./invariants";
import { boothBuyerSchema, resolveActiveBuyer, torontoDate } from "./shared";

export const chargeSchema = z
  .object({
    boothId: z.string().trim().min(1),
    buyer: boothBuyerSchema,
    items: z
      .array(
        z.object({ itemId: z.string().trim().min(1), qty: z.number().int().positive() }).strict(),
      )
      .min(1),
    expectedAmountCents: z.number().int().positive().multipleOf(CENT_STEP).optional(),
  })
  .strict();

export type ChargeInput = z.infer<typeof chargeSchema>;

export async function charge(args: {
  input: ChargeInput;
  idempotency: IdempotencyContext;
}): Promise<ChargeResult> {
  const { input, idempotency } = args;
  const actorUid = idempotency.actorUid;
  const createdDate = torontoDate(new Date());

  const boothRef = boothsCol().doc(input.boothId);
  const memberRef = membersCol(input.boothId).doc(actorUid);

  const { response }: IdempotentOutcome<ChargeResult> = await runIdempotent(
    idempotency,
    [boothRef, memberRef],
    async (t, actor, [boothSnapshot, memberSnapshot]) => {
      const booth = boothSnapshot.data();
      if (!booth || booth.status !== "approved") throw new BoothNotSellableError();

      if (!memberSnapshot.exists) {
        throw new ForbiddenError("You are not a member of this booth.");
      }

      const { uid: buyerUid, ref: buyerRef, data } = await resolveActiveBuyer(t, input.buyer);

      const lineItems: LedgerLineItem[] = input.items.map(({ itemId, qty }) => {
        const item = booth.items.find((i) => i.id === itemId);
        if (!item) throw new BoothNotSellableError("That item is not sold at this booth.");
        if (item.archived === true) {
          throw new CatalogChangedError(`${item.name} is no longer sold at this booth.`);
        }
        return { itemId, name: item.name, qty, unitPriceCents: item.priceCents };
      });

      const amountCents = lineItems.reduce((sum, li) => sum + li.qty * li.unitPriceCents, 0);

      if (input.expectedAmountCents !== undefined && input.expectedAmountCents !== amountCents) {
        throw new CatalogChangedError();
      }

      if (data.balanceCents < amountCents) throw new InsufficientFundsError();
      const balanceAfterCents = data.balanceCents - amountCents;
      assertNonNegative(balanceAfterCents);

      const tags = isHighAmount(amountCents) ? ["high-amount"] : [];
      const now = Timestamp.now();

      const entry: LedgerEntryDoc = {
        type: "purchase",
        amountCents,
        direction: "debit",
        balanceAfterCents,
        studentUid: buyerUid,
        studentNumber: data.studentNumber,
        studentName: data.displayName,
        actorUid,
        actorName: actor.displayName,
        boothId: input.boothId,
        boothName: booth.name,
        lineItems,
        tags,
        idempotencyKey: idempotency.key,
        createdAt: now,
        createdDate,
      };

      const entryRef = ledgerCol().doc();
      t.create(entryRef, entry);
      t.update(buyerRef, { balanceCents: balanceAfterCents, updatedAt: now });

      return {
        response: { entryId: entryRef.id, amountCents },
        ledgerEntryId: entryRef.id,
      };
    },
  );

  return response;
}
