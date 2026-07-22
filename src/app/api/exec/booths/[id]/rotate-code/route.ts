import "server-only";
import { z } from "zod";
import { writeAudit } from "@/lib/server/audit";
import { generateJoinCode } from "@/lib/server/boothCode";
import { boothsCol } from "@/lib/server/db";
import { ConflictError, InternalError, NotFoundError } from "@/lib/server/errors";
import { getAdminFirestore } from "@/lib/server/firebase-admin";
import { defineHandler } from "@/lib/server/http";

const MAX_CODE_ATTEMPTS = 10;

const rotateSchema = z.object({}).strict();

export const POST = defineHandler<typeof rotateSchema, { id: string }>(
  { role: "sacExec", schema: rotateSchema, rateLimit: "exec-mutations" },
  async ({ params, session }) => {
    const db = getAdminFirestore();
    const boothRef = boothsCol().doc(params.id);

    return db.runTransaction(async (t) => {
      const booth = (await t.get(boothRef)).data();
      if (!booth) throw new NotFoundError("Booth not found.");
      if (booth.status !== "approved") {
        throw new ConflictError("Only an approved booth has a join code to rotate.");
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

      t.update(boothRef, { joinCode });

      writeAudit(
        t,
        "booth.codeRotate",
        { uid: session!.uid, displayName: session!.displayName },
        { type: "booth", id: params.id, label: booth.name },
        { previousJoinCode: booth.joinCode, joinCode },
      );

      return { boothId: params.id, joinCode };
    });
  },
);
