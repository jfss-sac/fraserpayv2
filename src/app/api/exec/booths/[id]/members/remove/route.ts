import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { boothsCol, membersCol } from "@/lib/server/db";
import { NotFoundError } from "@/lib/server/errors";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";

const removeSchema = z.object({ uid: z.string().trim().min(1) }).strict();

export const POST = defineHandler<typeof removeSchema, { id: string }>(
  { role: "sacExec", schema: removeSchema, rateLimit: "exec-mutations" },
  async ({ input, params, session }) => {
    const db = getAdminFirestore();
    const boothRef = boothsCol().doc(params.id);
    const memberRef = membersCol(params.id).doc(input.uid);

    return db.runTransaction(async (t) => {
      const booth = (await t.get(boothRef)).data();
      if (!booth) throw new NotFoundError("Booth not found.");

      const member = (await t.get(memberRef)).data();

      t.delete(memberRef);

      writeAudit(
        t,
        "booth.memberRemove",
        { uid: session!.uid, displayName: session!.displayName },
        { type: "booth", id: params.id, label: booth.name },
        { uid: input.uid, displayName: member?.displayName ?? null },
      );

      return { boothId: params.id, uid: input.uid };
    });
  },
);
