import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { boothsCol } from "@/lib/server/db";
import { defineHandler } from "@/lib/server/http";
import { CUSTOM_ITEM, boothRegistrationSchema } from "@/lib/shared/booth";
import type { BoothItem } from "@/lib/shared/types";

export const POST = defineHandler(
  { role: "active", schema: boothRegistrationSchema, rateLimit: "register" },
  async ({ input, session }) => {
    const items: BoothItem[] = [
      ...input.items.map((item) => ({
        id: crypto.randomUUID(),
        name: item.name,
        priceCents: item.priceCents,
        isCustom: false,
      })),
      CUSTOM_ITEM,
    ];

    const ref = boothsCol().doc();
    await ref.set({
      name: input.name,
      nameLower: input.name.toLowerCase(),
      description: input.description,
      status: "pending",
      items,
      joinCode: null,
      submitterUid: session!.uid,
      submitterEmail: session!.email,
      createdAt: Timestamp.now(),
    });

    return { boothId: ref.id, status: "pending" as const };
  },
);
