import "server-only";
import { getBoothCatalog } from "@/lib/server/dal";
import { NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";

export const GET = defineHandler<undefined, { id: string }>(
  { role: "boothOperator", rateLimit: "reads" },
  async ({ params }) => {
    const catalog = await getBoothCatalog(params.id);
    if (!catalog) throw new NotFoundError("Booth not found.");
    return Response.json(catalog, { headers: { "cache-control": "no-store" } });
  },
);
