import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { writeAudit } from "@/lib/server/audit";
import { generateJoinCode } from "@/lib/server/boothCode";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { boothsCol } from "@/lib/server/db";
import { InternalError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import { CUSTOM_ITEM, boothRegistrationSchema } from "@/lib/shared/booth";
import type { BoothItem } from "@/lib/shared/types";

const MAX_CODE_ATTEMPTS = 10;

export const POST = defineHandler(
  { role: "sacExec", schema: boothRegistrationSchema, rateLimit: "exec-mutations" },
  async ({ input, session, authorization }) => {
    const boothRef = boothsCol().doc();
    const items: BoothItem[] = [
      ...input.items.map((item) => ({
        id: crypto.randomUUID(),
        name: item.name,
        priceCents: item.priceCents,
        isCustom: false,
      })),
      CUSTOM_ITEM,
    ];

    return runAuthorizedTransaction(authorization, async (t, actor) => {
      let joinCode: string | null = null;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        const candidate = generateJoinCode(input.name);
        const clash = await t.get(boothsCol().where("joinCode", "==", candidate).limit(1));
        if (clash.empty) {
          joinCode = candidate;
          break;
        }
      }
      if (!joinCode) throw new InternalError();

      const now = Timestamp.now();
      t.create(boothRef, {
        name: input.name,
        nameLower: input.name.toLowerCase(),
        description: input.description,
        status: "approved",
        items,
        joinCode,
        submitterUid: actor.uid,
        submitterEmail: session!.email,
        createdAt: now,
        approvedAt: now,
        approvedByUid: actor.uid,
      });

      writeAudit(
        t,
        "booth.create",
        actor,
        { type: "booth", id: boothRef.id, label: input.name },
        { joinCode },
      );

      return { boothId: boothRef.id, status: "approved" as const, joinCode };
    });
  },
);
