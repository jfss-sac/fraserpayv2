import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { getCachedEventReports } from "@/lib/server/sac-reports";
import { ReportsView } from "./reports-view";

export const metadata: Metadata = {
  title: "Event reports",
};

export default async function ReportsPage() {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  const data = await getCachedEventReports();
  return <ReportsView data={data} />;
}
