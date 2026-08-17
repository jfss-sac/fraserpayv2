import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { type LedgerEntryDoc, ledgerCol } from "../db";
import { ConflictError, InsufficientFundsError, ValidationError } from "../errors";
import { type IdempotencyContext, type IdempotentOutcome, runIdempotent } from "../idempotency";
import { CENT_STEP } from "@/lib/shared/constants";
import { firestoreDocumentIdSchema } from "@/lib/shared/document-id";
import { pointsFor } from "@/lib/shared/money";
import type { AdjustResult } from "@/lib/shared/types";
import { assertNonNegative, assertNotSelf } from "./invariants";
import { readUser, torontoDate } from "./shared";

export const adjustSchema = z
  .object({
    studentUid: firestoreDocumentIdSchema,
    amountCents: z
      .number()
      .int()
      .multipleOf(CENT_STEP)
      .refine((v) => v !== 0, "Amount must be non-zero."),
    reason: z.string().trim().min(1).max(280),
    originalEntryId: firestoreDocumentIdSchema.optional(),
  })
  .strict();

export type AdjustInput = z.infer<typeof adjustSchema>;

export async function adjustBalance(args: {
  input: AdjustInput;
  idempotency: IdempotencyContext;
}): Promise<AdjustResult> {
  const { input, idempotency } = args;
  const actorUid = idempotency.actorUid;
  assertNotSelf(
    actorUid,
    input.studentUid,
    "You can't adjust your own balance — another exec must do it.",
  );
  const createdDate = torontoDate(new Date());

  const { response }: IdempotentOutcome<AdjustResult> = await runIdempotent(
    idempotency,
    [],
    async (t, actor) => {
      const { ref, data } = await readUser(t, input.studentUid);

      const balanceAfterCents = data.balanceCents + input.amountCents;
      if (balanceAfterCents < 0) throw new InsufficientFundsError();

      let pointsDelta: number | undefined;
      if (input.originalEntryId !== undefined) {
        if (input.amountCents > 0) {
          throw new ValidationError("A top-up link can only be used for a reversal.");
        }
        const original = (await t.get(ledgerCol().doc(input.originalEntryId))).data();
        if (!original || original.type !== "topup" || original.studentUid !== input.studentUid) {
          throw new ValidationError("The linked entry must be a top-up for this student.");
        }
        const prior = await t.get(
          ledgerCol().where("originalEntryId", "==", input.originalEntryId),
        );
        const reversedCents = prior.docs.reduce((sum, doc) => {
          const entry = doc.data();
          return entry.type === "adjustment" && entry.direction === "debit"
            ? sum + entry.amountCents
            : sum;
        }, 0);
        if (reversedCents + Math.abs(input.amountCents) > original.amountCents) {
          throw new ConflictError("This exceeds the top-up's remaining reversible amount.");
        }
        const raw = pointsFor(input.amountCents);
        const pointsAfter = Math.max(0, data.points + raw);
        pointsDelta = pointsAfter - data.points;
      }

      const pointsAfter = data.points + (pointsDelta ?? 0);
      assertNonNegative(pointsAfter);
      const now = Timestamp.now();

      const entry: LedgerEntryDoc = {
        type: "adjustment",
        amountCents: Math.abs(input.amountCents),
        direction: input.amountCents > 0 ? "credit" : "debit",
        balanceAfterCents,
        studentUid: input.studentUid,
        studentNumber: data.studentNumber,
        studentName: data.displayName,
        actorUid,
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
    },
  );

  return response;
}
