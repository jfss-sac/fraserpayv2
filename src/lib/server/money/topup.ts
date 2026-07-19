import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type LedgerEntryDoc, ledgerCol } from "../db";
import { CapExceededError, InternalError } from "../errors";
import { type IdempotencyContext, runIdempotent } from "../idempotency";
import { CENT_STEP } from "@/lib/shared/constants";
import { exceedsBalanceCap, exceedsTopupCap, pointsFor } from "@/lib/shared/money";
import type { TopUpResult } from "@/lib/shared/types";
import { buyerSchema, readActiveBuyer, resolveBuyerUid, torontoDate } from "./shared";

export const topUpSchema = z
  .object({
    buyer: buyerSchema,
    amountCents: z.number().int().positive().multipleOf(CENT_STEP),
    method: z.enum(["cash", "card"]),
    overrideReason: z.string().trim().min(1).max(280).optional(),
  })
  .strict();

export type TopUpInput = z.infer<typeof topUpSchema>;

export interface TopUpActor {
  uid: string;
  displayName: string;
  isExec: boolean;
}

export async function topUp(args: {
  input: TopUpInput;
  actor: TopUpActor;
  idempotency: IdempotencyContext;
}): Promise<TopUpResult> {
  const { input, actor, idempotency } = args;
  const buyerUid = await resolveBuyerUid(input.buyer);
  const createdDate = torontoDate(new Date());

  const { response } = await runIdempotent<TopUpResult>(idempotency, async (t) => {
    const { ref, data } = await readActiveBuyer(t, buyerUid);

    const balanceAfterCents = data.balanceCents + input.amountCents;

    const tags: string[] = [];
    let reason: string | undefined;
    if (exceedsTopupCap(input.amountCents) || exceedsBalanceCap(balanceAfterCents)) {
      reason = input.overrideReason;
      if (!actor.isExec || !reason) {
        throw new CapExceededError(
          "This exceeds the $100 top-up or $200 balance cap. An exec must override with a reason.",
        );
      }
      tags.push("cap-override");
    }

    if (balanceAfterCents < 0) throw new InternalError();

    const points = pointsFor(input.amountCents);
    const pointsAfter = data.points + points;
    const now = Timestamp.now();

    const entry: LedgerEntryDoc = {
      type: "topup",
      amountCents: input.amountCents,
      direction: "credit",
      balanceAfterCents,
      studentUid: buyerUid,
      studentNumber: data.studentNumber,
      studentName: data.displayName,
      actorUid: actor.uid,
      actorName: actor.displayName,
      tags,
      idempotencyKey: idempotency.key,
      createdAt: now,
      createdDate,
      method: input.method,
      pointsDelta: points,
      ...(reason !== undefined ? { reason } : {}),
    };

    const entryRef = ledgerCol().doc();
    t.create(entryRef, entry);
    t.update(ref, { balanceCents: balanceAfterCents, points: pointsAfter, updatedAt: now });

    return {
      response: {
        entryId: entryRef.id,
        amountCents: input.amountCents,
        balanceAfterCents,
        points: pointsAfter,
      },
      ledgerEntryId: entryRef.id,
    };
  });

  return response;
}
