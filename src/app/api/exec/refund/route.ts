import "server-only";
import { defineHandler } from "@/lib/server/http";
import { refundPurchase, refundSchema } from "@/lib/server/money/refund";

export const POST = defineHandler(
  { role: "sacExec", schema: refundSchema, rateLimit: "exec-mutations", idempotent: true },
  async ({ input, idempotency }) => {
    const result = await refundPurchase({
      input,
      idempotency: idempotency!,
    });
    return { ...result };
  },
);
