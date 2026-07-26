import "server-only";
import { defineHandler } from "@/lib/server/http";
import { getStudentLedger, studentLedgerQuerySchema } from "@/lib/server/sac-students";

export const GET = defineHandler<typeof studentLedgerQuerySchema, { uid: string }>(
  { role: "sacMember", schema: studentLedgerQuerySchema, rateLimit: "reads" },
  async ({ input, params }) => {
    const body = await getStudentLedger(params.uid, input.cursor);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  },
);
