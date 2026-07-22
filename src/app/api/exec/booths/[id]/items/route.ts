import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { boothsCol } from "@/lib/server/db";
import { NotFoundError, ValidationError } from "@/lib/server/errors";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";
import { isValidAmount } from "@/lib/shared/money";
import type { BoothItem } from "@/lib/shared/types";

const itemsSchema = z
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
      .min(1)
      .max(50),
  })
  .strict();

type PriceEdits = z.infer<typeof itemsSchema>["priceEdits"];

interface PriceDiff {
  id: string;
  name: string;
  before: number;
  after: number;
}

function applyPriceEdits(
  items: BoothItem[],
  edits: PriceEdits,
): { items: BoothItem[]; diff: PriceDiff[] } {
  const next = items.map((item) => ({ ...item }));
  const byId = new Map(next.map((item) => [item.id, item]));
  const diff: PriceDiff[] = [];
  for (const edit of edits) {
    const item = byId.get(edit.id);
    if (!item) throw new ValidationError("That item is not part of this booth.");
    if (item.isCustom) throw new ValidationError("The custom item's price is locked.");
    if (item.priceCents !== edit.priceCents) {
      diff.push({ id: item.id, name: item.name, before: item.priceCents, after: edit.priceCents });
      item.priceCents = edit.priceCents;
    }
  }
  return { items: next, diff };
}

export const POST = defineHandler<typeof itemsSchema, { id: string }>(
  { role: "sacExec", schema: itemsSchema, rateLimit: "exec-mutations" },
  async ({ input, params, session }) => {
    const db = getAdminFirestore();
    const boothRef = boothsCol().doc(params.id);

    return db.runTransaction(async (t) => {
      const booth = (await t.get(boothRef)).data();
      if (!booth) throw new NotFoundError("Booth not found.");

      const { items, diff } = applyPriceEdits(booth.items, input.priceEdits);

      t.update(boothRef, { items });

      writeAudit(
        t,
        "booth.priceEdit",
        { uid: session!.uid, displayName: session!.displayName },
        { type: "booth", id: params.id, label: booth.name },
        { diff },
      );

      return { boothId: params.id, items };
    });
  },
);
