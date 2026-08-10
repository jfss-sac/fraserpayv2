import "server-only";
import { getBoothSummary } from "@/lib/server/dal";
import { NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";

export const GET = defineHandler<undefined, { id: string }>(
  { role: "sacMember", rateLimit: "reads" },
  async ({ params }) => {
    const summary = await getBoothSummary(params.id);
    if (!summary) throw new NotFoundError("Booth not found.");
    return { ...summary };
  },
);
