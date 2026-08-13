import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { runAuthorizedTransaction } from "@/lib/server/dal";
import { boothsCol } from "@/lib/server/db";
import { AppError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";
import { requestHash } from "@/lib/server/idempotency";
import { logger } from "@/lib/server/logger";
import { CUSTOM_ITEM, boothRegistrationSchema } from "@/lib/shared/booth";
import type { BoothItem, BoothStatus } from "@/lib/shared/types";

export const POST = defineHandler(
  { role: "active", schema: boothRegistrationSchema, rateLimit: "register" },
  async ({ input, session, authorization }) => {
    const ref = boothsCol().doc(
      `registration_${requestHash({ submitterUid: session!.uid, registration: input })}`,
    );
    const items: BoothItem[] = [
      ...input.items.map((item) => ({
        id: crypto.randomUUID(),
        name: item.name,
        priceCents: item.priceCents,
        isCustom: false,
      })),
      CUSTOM_ITEM,
    ];

    const status: BoothStatus = "pending";
    try {
      return await runAuthorizedTransaction(authorization, async (t) => {
        t.create(ref, {
          name: input.name,
          nameLower: input.name.toLowerCase(),
          description: input.description,
          status,
          items,
          joinCode: null,
          submitterUid: session!.uid,
          submitterEmail: session!.email,
          createdAt: Timestamp.now(),
        });
        return { boothId: ref.id, status };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const existing = (await ref.get()).data();
      if (!existing) throw error;
      logger.warn({ event: "booth_register_deduped", err: error });
      return { boothId: ref.id, status: existing.status };
    }
  },
);
