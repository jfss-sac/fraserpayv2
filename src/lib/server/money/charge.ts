import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type LedgerEntryDoc, boothsCol, ledgerCol, membersCol } from "../db";
import { BoothNotSellableError, ForbiddenError, InsufficientFundsError } from "../errors";
import { type IdempotencyContext, runIdempotent } from "../idempotency";
import { isHighAmount } from "@/lib/shared/money";
import type { ChargeResult, LedgerLineItem } from "@/lib/shared/types";
import { assertNonNegative } from "./invariants";
import { buyerSchema, readActiveBuyer, resolveBuyerUid, torontoDate } from "./shared";

export const chargeSchema = z
  .object({
    boothId: z.string().trim().min(1),
    buyer: buyerSchema,
    items: z
      .array(
        z.object({ itemId: z.string().trim().min(1), qty: z.number().int().positive() }).strict(),
      )
      .min(1),
  })
  .strict();

export type ChargeInput = z.infer<typeof chargeSchema>;

export interface ChargeActor {
  uid: string;
  displayName: string;
}

export async function charge(args: {
  input: ChargeInput;
  actor: ChargeActor;
  idempotency: IdempotencyContext;
}): Promise<ChargeResult> {
  const { input, actor, idempotency } = args;
  const buyerUid = await resolveBuyerUid(input.buyer);
  const createdDate = torontoDate(new Date());

  const { response } = await runIdempotent<ChargeResult>(idempotency, async (t) => {
    const boothRef = boothsCol().doc(input.boothId);
    const booth = (await t.get(boothRef)).data();
    if (!booth || booth.status !== "approved") throw new BoothNotSellableError();

    const member = await t.get(membersCol(input.boothId).doc(actor.uid));
    if (!member.exists) throw new ForbiddenError("You are not a member of this booth.");

    const { ref, data } = await readActiveBuyer(t, buyerUid);

    const lineItems: LedgerLineItem[] = input.items.map(({ itemId, qty }) => {
      const item = booth.items.find((i) => i.id === itemId);
      if (!item) throw new BoothNotSellableError("That item is not sold at this booth.");
      return { itemId, name: item.name, qty, unitPriceCents: item.priceCents };
    });

    const amountCents = lineItems.reduce((sum, li) => sum + li.qty * li.unitPriceCents, 0);

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
      actorUid: actor.uid,
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
    t.update(ref, { balanceCents: balanceAfterCents, updatedAt: now });

    return {
      response: { entryId: entryRef.id, amountCents },
      ledgerEntryId: entryRef.id,
    };
  });

  return response;
}
