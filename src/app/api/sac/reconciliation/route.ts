import "server-only";
import { defineHandler } from "@/lib/server/http";
import { getReconciliation, reconciliationQuerySchema } from "@/lib/server/sac-reconciliation";

export const GET = defineHandler(
  { role: "sacMember", schema: reconciliationQuerySchema, rateLimit: "reads" },
  async ({ input }) => {
    const body = await getReconciliation(input);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  },
);
