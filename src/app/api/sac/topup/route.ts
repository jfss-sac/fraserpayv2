import "server-only";
import { defineHandler } from "@/lib/server/http";
import { topUp, topUpSchema } from "@/lib/server/money/topup";

export const POST = defineHandler(
  { role: "sacMember", schema: topUpSchema, rateLimit: "topup", idempotent: true },
  async ({ input, session, idempotency }) => {
    const result = await topUp({
      input,
      actor: {
        uid: session!.uid,
        displayName: session!.displayName,
        isExec: session!.roles.sacExec,
      },
      idempotency: idempotency!,
    });
    return { ...result };
  },
);
