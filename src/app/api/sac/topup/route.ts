import "server-only";
import { defineHandler } from "@/lib/server/http";
import { topUp, topUpSchema } from "@/lib/server/money/topup";

export const POST = defineHandler(
  { role: "sacMember", schema: topUpSchema, rateLimit: "topup", idempotent: true },
  async ({ input, idempotency }) => {
    const result = await topUp({
      input,
      idempotency: idempotency!,
    });
    return { ...result };
  },
);
