import "server-only";
import { boothHistoryQuerySchema, getBoothHistory } from "@/lib/server/dal";
import { defineHandler } from "@/lib/server/http";

const sacBoothHistoryQuerySchema = boothHistoryQuerySchema.omit({ mine: true });

export const GET = defineHandler<typeof sacBoothHistoryQuerySchema, { id: string }>(
  { role: "sacMember", schema: sacBoothHistoryQuerySchema, rateLimit: "reads" },
  async ({ input, params }) => {
    const body = await getBoothHistory(params.id, { cursor: input.cursor });
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  },
);
