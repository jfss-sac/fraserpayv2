import "server-only";
import { defineHandler } from "@/lib/server/http";
import { charge, chargeSchema } from "@/lib/server/money/charge";

export const POST = defineHandler(
  { role: "active", schema: chargeSchema, rateLimit: "charge", idempotent: true },
  async ({ input, session, idempotency }) => {
    const result = await charge({
      input,
      actor: { uid: session!.uid, displayName: session!.displayName },
      idempotency: idempotency!,
    });
    return { ...result };
  },
);
