import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { boothsCol } from "@/lib/server/db";
import { ConflictError, NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";

const statusSchema = z.object({ active: z.boolean() }).strict();

export const POST = defineHandler<typeof statusSchema, { id: string }>(
  { role: "sacExec", schema: statusSchema, rateLimit: "exec-mutations" },
  async ({ input, params, session }) => {
    const boothRef = boothsCol().doc(params.id);

    return runAuthorizedTransaction({ actorUid: session!.uid, role: "sacExec" }, async (t) => {
      const booth = (await t.get(boothRef)).data();
      if (!booth) throw new NotFoundError("Booth not found.");

      const from = input.active ? "deactivated" : "approved";
      const to = input.active ? "approved" : "deactivated";
      if (booth.status !== from) {
        throw new ConflictError(
          input.active
            ? "Only a deactivated booth can be reactivated."
            : "Only an approved booth can be deactivated.",
        );
      }

      t.update(boothRef, { status: to });

      writeAudit(
        t,
        input.active ? "booth.reactivate" : "booth.deactivate",
        { uid: session!.uid, displayName: session!.displayName },
        { type: "booth", id: params.id, label: booth.name },
        {},
      );

      return { boothId: params.id, status: to };
    });
  },
);
