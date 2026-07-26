import "server-only";
import { defineHandler } from "@/lib/server/http";
import { searchStudents, studentSearchSchema } from "@/lib/server/sac-students";
import type { StudentSearchDTO } from "@/lib/shared/types";

export const GET = defineHandler(
  { role: "sacMember", schema: studentSearchSchema, rateLimit: "reads" },
  async ({ input }) => {
    const body: StudentSearchDTO = { results: await searchStudents(input.q) };
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  },
);
