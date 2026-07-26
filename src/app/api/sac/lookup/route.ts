import "server-only";
import { defineHandler } from "@/lib/server/http";
import { sacLookupBuyer, sacLookupSchema } from "@/lib/server/sac-lookup";

export const POST = defineHandler(
  { role: "sacMember", schema: sacLookupSchema, rateLimit: "lookup" },
  async ({ input }) => {
    return { ...(await sacLookupBuyer(input)) };
  },
);
