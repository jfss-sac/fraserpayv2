import "server-only";
import { getBoothSummary, isBoothMember } from "@/lib/server/dal";
import { ForbiddenError, NotFoundError } from "@/lib/server/errors";
import { defineHandler } from "@/lib/server/http";

export const GET = defineHandler<undefined, { id: string }>(
  { role: "active" },
  async ({ params, session }) => {
    if (!(await isBoothMember(params.id, session!.uid))) {
      throw new ForbiddenError("You are not a member of this booth.");
    }
    const summary = await getBoothSummary(params.id);
    if (!summary) throw new NotFoundError("Booth not found.");
    return { ...summary };
  },
);
