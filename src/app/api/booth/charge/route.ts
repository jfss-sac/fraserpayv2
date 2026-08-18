import "server-only";
import { defineHandler } from "@/lib/server/http";
import { charge, chargeSchema } from "@/lib/server/money/charge";

export const POST = defineHandler(
  { role: "boothOperator", schema: chargeSchema, rateLimit: "charge", idempotent: true },
  async ({ input, idempotency }) => {
    const result = await charge({
      input,
      idempotency: idempotency!,
    });
    return { ...result };
  },
);
