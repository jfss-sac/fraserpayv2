import "server-only";
import { defineHandler } from "@/lib/server/http";
import { adjustBalance, adjustSchema } from "@/lib/server/money/adjust";

export const POST = defineHandler(
  { role: "sacExec", schema: adjustSchema, rateLimit: "exec-mutations", idempotent: true },
  async ({ input, session, idempotency }) => {
    const result = await adjustBalance({
      input,
      actor: { uid: session!.uid, displayName: session!.displayName },
      idempotency: idempotency!,
    });
    return { ...result };
  },
);
