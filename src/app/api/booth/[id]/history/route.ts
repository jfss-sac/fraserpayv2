import "server-only";
import { boothHistoryQuerySchema, getBoothHistory } from "@/lib/server/dal";
import { defineHandler } from "@/lib/server/http";

export const GET = defineHandler<typeof boothHistoryQuerySchema, { id: string }>(
  { role: "boothMember", schema: boothHistoryQuerySchema, rateLimit: "reads" },
  async ({ input, params, session }) => {
    const body = await getBoothHistory(params.id, {
      cursor: input.cursor,
      ...(input.mine ? { actorUid: session!.uid } : {}),
    });
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  },
);
