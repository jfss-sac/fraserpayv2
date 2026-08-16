import "server-only";
import { lookupBuyer, lookupSchema } from "@/lib/server/booth-lookup";
import { defineHandler } from "@/lib/server/http";

export const POST = defineHandler(
  { role: "boothOperator", schema: lookupSchema, rateLimit: "lookup" },
  async ({ input }) => {
    return { ...(await lookupBuyer(input)) };
  },
);
