import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type LedgerEntryDoc, ledgerCol } from "../db";
import { InsufficientFundsError, InternalError, ValidationError } from "../errors";
import { type IdempotencyContext, runIdempotent } from "../idempotency";
import { CENT_STEP } from "@/lib/shared/constants";
import { pointsFor } from "@/lib/shared/money";
import type { AdjustResult } from "@/lib/shared/types";
import { readUser, torontoDate } from "./shared";

export const adjustSchema = z
  .object({
    studentUid: z.string().trim().min(1),
    amountCents: z
      .number()
      .int()
      .multipleOf(CENT_STEP)
      .refine((v) => v !== 0, "Amount must be non-zero."),
    reason: z.string().trim().min(1).max(280),
    originalEntryId: z.string().trim().min(1).optional(),
  })
  .strict();

export type AdjustInput = z.infer<typeof adjustSchema>;

export interface AdjustActor {
  uid: string;
  displayName: string;
}

export async function adjustBalance(args: {
  input: AdjustInput;
  actor: AdjustActor;
  idempotency: IdempotencyContext;
}): Promise<AdjustResult> {
  const { input, actor, idempotency } = args;
  const createdDate = torontoDate(new Date());

  const { response } = await runIdempotent<AdjustResult>(idempotency, async (t) => {
    const { ref, data } = await readUser(t, input.studentUid);

    const balanceAfterCents = data.balanceCents + input.amountCents;
    if (balanceAfterCents < 0) throw new InsufficientFundsError();

    let pointsDelta: number | undefined;
    if (input.originalEntryId !== undefined) {
      const original = (await t.get(ledgerCol().doc(input.originalEntryId))).data();
      if (!original || original.type !== "topup" || original.studentUid !== input.studentUid) {
        throw new ValidationError("The linked entry must be a top-up for this student.");
      }
      const raw = pointsFor(input.amountCents);
      const pointsAfter = Math.max(0, data.points + raw);
      pointsDelta = pointsAfter - data.points;
    }

    const pointsAfter = data.points + (pointsDelta ?? 0);
    if (pointsAfter < 0) throw new InternalError();
    const now = Timestamp.now();

    const entry: LedgerEntryDoc = {
      type: "adjustment",
      amountCents: Math.abs(input.amountCents),
      direction: input.amountCents > 0 ? "credit" : "debit",
      balanceAfterCents,
      studentUid: input.studentUid,
      studentNumber: data.studentNumber,
      studentName: data.displayName,
      actorUid: actor.uid,
      actorName: actor.displayName,
      tags: [],
      idempotencyKey: idempotency.key,
      createdAt: now,
      createdDate,
      reason: input.reason,
      ...(input.originalEntryId !== undefined ? { originalEntryId: input.originalEntryId } : {}),
      ...(pointsDelta !== undefined ? { pointsDelta } : {}),
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
