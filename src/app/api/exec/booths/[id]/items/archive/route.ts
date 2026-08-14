import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { boothsCol } from "@/lib/server/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import type { BoothItem } from "@/lib/shared/types";

const archiveSchema = z
  .object({ itemId: z.string().trim().min(1), archived: z.boolean() })
  .strict();

function withArchived(item: BoothItem, archived: boolean): BoothItem {
  const next = { ...item };
  if (archived) next.archived = true;
  else delete next.archived;
  return next;
}

export const POST = defineHandler<typeof archiveSchema, { id: string }>(
  { role: "sacExec", schema: archiveSchema, rateLimit: "exec-mutations" },
  async ({ input, params, authorization }) => {
    const boothRef = boothsCol().doc(params.id);

    return runAuthorizedTransaction(authorization, async (t, actor) => {
      const booth = (await t.get(boothRef)).data();
      if (!booth) throw new NotFoundError("Booth not found.");

      const target = booth.items.find((item) => item.id === input.itemId);
      if (!target) throw new ValidationError("That item is not part of this booth.");
      if (target.isCustom) throw new ValidationError("The custom item can't be archived.");
      if ((target.archived === true) === input.archived) {
        throw new ConflictError(
          input.archived ? "That item is already archived." : "That item is already for sale.",
        );
      }

      const items = booth.items.map((item) =>
        item.id === input.itemId ? withArchived(item, input.archived) : item,
      );

      t.update(boothRef, { items });

      writeAudit(
        t,
        input.archived ? "booth.itemArchive" : "booth.itemUnarchive",
        actor,
        { type: "booth", id: params.id, label: booth.name },
        { itemId: target.id, name: target.name },
      );

      return { boothId: params.id, itemId: target.id, archived: input.archived };
    });
  },
);
