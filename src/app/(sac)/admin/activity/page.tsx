import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActivity } from "@/lib/server/activity";
import { getSession } from "@/lib/server/dal";
import { ActivityView } from "./activity-view";

export const metadata: Metadata = {
  title: "Account activity",
};

export default async function ActivityPage() {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  const data = await getActivity();
  return <ActivityView data={data} isExec={session.roles.sacExec} viewerUid={session.uid} />;
}
