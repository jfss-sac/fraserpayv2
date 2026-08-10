"use server";

import { revalidateTag } from "next/cache";
import { getSession } from "@/lib/server/dal";
import { ForbiddenError } from "@/lib/server/errors";
import { REPORTS_CACHE_TAG } from "@/lib/server/sac-reports";

export async function refreshEventReports(): Promise<void> {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    throw new ForbiddenError();
  }
  revalidateTag(REPORTS_CACHE_TAG, { expire: 0 });
}
