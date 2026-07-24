import "server-only";
import { lookupBuyer, lookupSchema } from "@/lib/server/booth-lookup";
import { defineHandler } from "@/lib/server/http";

export const POST = defineHandler(
  { role: "active", schema: lookupSchema, rateLimit: "lookup" },
  async ({ input, session }) => {
    return { ...(await lookupBuyer({ input, actorUid: session!.uid })) };
  },
);
