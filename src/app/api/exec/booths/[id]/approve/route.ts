import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { generateJoinCode } from "@/lib/server/boothCode";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { boothsCol } from "@/lib/server/db";
import { ConflictError, InternalError, NotFoundError, ValidationError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import { formatCents, isValidAmount } from "@/lib/shared/money";
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

type PriceEdits = NonNullable<z.infer<typeof approveSchema>["priceEdits"]>;

function applyPriceEdits(items: BoothItem[], edits: PriceEdits): BoothItem[] {
  if (edits.length === 0) return items;
  const next = items.map((item) => ({ ...item }));
  const byId = new Map(next.map((item) => [item.id, item]));
  for (const edit of edits) {
    const item = byId.get(edit.id);
    if (!item) throw new ValidationError("That item is not part of this booth.");
    if (item.isCustom) throw new ValidationError("The custom item's price is locked.");
    if (item.archived) throw new ValidationError("Restore that item before changing its price.");
    item.priceCents = edit.priceCents;
  }
  return next;
}

function formatPriceEdits(edits: PriceEdits): string {
  if (edits.length === 0) return "No price edits";
  return edits.map(({ id, priceCents }) => `${id}: ${formatCents(priceCents)}`).join("; ");
}

export const POST = defineHandler<typeof approveSchema, { id: string }>(
  { role: "sacExec", schema: approveSchema, rateLimit: "exec-mutations" },
  async ({ input, params, authorization }) => {
    const boothRef = boothsCol().doc(params.id);

    return runAuthorizedTransaction(authorization, async (t, actor) => {
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

      const priceEdits = input.priceEdits ?? [];
      const items = applyPriceEdits(booth.items, priceEdits);

      t.update(boothRef, {
        status: "approved",
        joinCode,
        items,
        approvedAt: Timestamp.now(),
        approvedByUid: actor.uid,
      });

      writeAudit(
        t,
        "booth.approve",
        actor,
        { type: "booth", id: params.id, label: booth.name },
        { joinCode, priceEdits: formatPriceEdits(priceEdits) },
      );

      return { boothId: params.id, status: "approved" as const, joinCode };
    });
  },
);
