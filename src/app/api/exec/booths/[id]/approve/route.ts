import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { generateJoinCode } from "@/lib/server/boothCode";
import { boothsCol } from "@/lib/server/db";
import { ConflictError, InternalError, NotFoundError, ValidationError } from "@/lib/server/errors";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";
import { isValidAmount } from "@/lib/shared/money";
import type { BoothItem } from "@/lib/shared/types";

const MAX_CODE_ATTEMPTS = 10;

const approveSchema = z
  .object({
    priceEdits: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            priceCents: z
              .number()
              .int()
              .refine(isValidAmount, "Item prices must be a positive multiple of $0.50."),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict();

type PriceEdit = z.infer<typeof approveSchema>["priceEdits"];

function applyPriceEdits(items: BoothItem[], edits: PriceEdit): BoothItem[] {
  if (!edits || edits.length === 0) return items;
  const next = items.map((item) => ({ ...item }));
  const byId = new Map(next.map((item) => [item.id, item]));
  for (const edit of edits) {
    const item = byId.get(edit.id);
    if (!item) throw new ValidationError("That item is not part of this booth.");
    if (item.isCustom) throw new ValidationError("The custom item's price is locked.");
    item.priceCents = edit.priceCents;
  }
  return next;
}

export const POST = defineHandler<typeof approveSchema, { id: string }>(
  { role: "sacExec", schema: approveSchema, rateLimit: "exec-mutations" },
  async ({ input, params, session }) => {
    const db = getAdminFirestore();
    const boothRef = boothsCol().doc(params.id);

    return db.runTransaction(async (t) => {
      const booth = (await t.get(boothRef)).data();
      if (!booth) throw new NotFoundError("Booth not found.");
      if (booth.status !== "pending") {
        throw new ConflictError("This booth has already been reviewed.");
      }

      let joinCode: string | null = null;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        const candidate = generateJoinCode(booth.name);
        const clash = await t.get(boothsCol().where("joinCode", "==", candidate).limit(1));
        if (clash.empty) {
          joinCode = candidate;
          break;
        }
      }
      if (!joinCode) throw new InternalError();

      const items = applyPriceEdits(booth.items, input.priceEdits);

      t.update(boothRef, {
        status: "approved",
        joinCode,
        items,
        approvedAt: Timestamp.now(),
        approvedByUid: session!.uid,
      });

      writeAudit(
        t,
        "booth.approve",
        { uid: session!.uid, displayName: session!.displayName },
        { type: "booth", id: params.id, label: booth.name },
        { joinCode, priceEdits: input.priceEdits ?? [] },
      );

      return { boothId: params.id, status: "approved" as const, joinCode };
    });
  },
);
