import "server-only";
import { defineHandler } from "@/lib/server/http";
import { getEventReports } from "@/lib/server/sac-reports";

export const GET = defineHandler({ role: "sacMember", rateLimit: "reads" }, async () => {
  const body = await getEventReports();
  return Response.json(body, { headers: { "cache-control": "no-store" } });
});
