import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type LedgerEntryDoc, ledgerCol } from "../db";
import { CapExceededError } from "../errors";
import { type IdempotencyContext, type IdempotentOutcome, runIdempotent } from "../idempotency";
import { assertNonNegative, assertNotSelf } from "./invariants";
import { CENT_STEP } from "@/lib/shared/constants";
import { exceedsBalanceCap, exceedsTopupCap, pointsFor } from "@/lib/shared/money";
import type { TopUpResult } from "@/lib/shared/types";
import { buyerSchema, resolveActiveBuyer, torontoDate } from "./shared";

export const topUpSchema = z
  .object({
    buyer: buyerSchema,
    amountCents: z.number().int().positive().multipleOf(CENT_STEP),
    method: z.enum(["cash", "card"]),
    overrideReason: z.string().trim().min(1).max(280).optional(),
  })
  .strict();

export type TopUpInput = z.infer<typeof topUpSchema>;

export async function topUp(args: {
  input: TopUpInput;
  idempotency: IdempotencyContext;
}): Promise<TopUpResult> {
  const { input, idempotency } = args;
  const actorUid = idempotency.actorUid;
  const createdDate = torontoDate(new Date());

  const { response }: IdempotentOutcome<TopUpResult> = await runIdempotent(
    idempotency,
    [],
    async (t, actor) => {
      const { uid: buyerUid, ref, data } = await resolveActiveBuyer(t, input.buyer);
      assertNotSelf(
        actorUid,
        buyerUid,
        "You can't top up your own account, another SAC member must do it.",
      );

      const balanceAfterCents = data.balanceCents + input.amountCents;

      const tags: string[] = [];
      let reason: string | undefined;
      if (exceedsTopupCap(input.amountCents) || exceedsBalanceCap(balanceAfterCents)) {
        reason = input.overrideReason;
        if (!actor.roles.sacExec || !reason) {
          throw new CapExceededError(
            "This exceeds the $100 top-up or $200 balance cap. An exec must override with a reason.",
          );
        }
        tags.push("cap-override");
      }

      assertNonNegative(balanceAfterCents);

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
        actorUid,
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
    },
  );

  return response;
}
