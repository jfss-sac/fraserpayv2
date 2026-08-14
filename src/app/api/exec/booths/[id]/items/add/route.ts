import "server-only";
import { writeAudit } from "@/lib/server/audit";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { boothsCol } from "@/lib/server/db";
import { ConflictError, NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import { MAX_BOOTH_ITEMS, boothItemInputSchema } from "@/lib/shared/booth";
import type { BoothItem } from "@/lib/shared/types";

export const POST = defineHandler<typeof boothItemInputSchema, { id: string }>(
  { role: "sacExec", schema: boothItemInputSchema, rateLimit: "exec-mutations" },
  async ({ input, params, authorization }) => {
    const boothRef = boothsCol().doc(params.id);

    return runAuthorizedTransaction(authorization, async (t, actor) => {
      const booth = (await t.get(boothRef)).data();
      if (!booth) throw new NotFoundError("Booth not found.");

      const forSale = booth.items.filter((existing) => !existing.isCustom && !existing.archived);
      if (forSale.length >= MAX_BOOTH_ITEMS) {
        throw new ConflictError(
          `A booth can sell ${MAX_BOOTH_ITEMS} items at a time. Archive one before adding another.`,
        );
      }

      const item: BoothItem = {
        id: crypto.randomUUID(),
        name: input.name,
        priceCents: input.priceCents,
        isCustom: false,
      };

      const customIndex = booth.items.findIndex((existing) => existing.isCustom);
      const at = customIndex === -1 ? booth.items.length : customIndex;
      const items = [...booth.items.slice(0, at), item, ...booth.items.slice(at)];

      t.update(boothRef, { items });

      writeAudit(
        t,
        "booth.itemAdd",
        actor,
        { type: "booth", id: params.id, label: booth.name },
        { itemId: item.id, name: item.name, priceCents: item.priceCents },
      );

      return { boothId: params.id, item };
    });
  },
);
