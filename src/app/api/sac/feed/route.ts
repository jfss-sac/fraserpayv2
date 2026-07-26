import "server-only";
import { defineHandler } from "@/lib/server/http";
import { feedQuerySchema, getFeed } from "@/lib/server/sac-feed";

export const GET = defineHandler(
  { role: "sacMember", schema: feedQuerySchema, rateLimit: "reads" },
  async ({ input }) => {
    const body = await getFeed(input);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  },
);
