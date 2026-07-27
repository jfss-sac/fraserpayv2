import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { torontoDate } from "@/lib/server/money/shared";
import { ReconciliationView } from "./reconciliation-view";

export const metadata: Metadata = {
  title: "Reconciliation",
};

export default async function ReconciliationPage() {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  return <ReconciliationView initialDate={torontoDate(new Date())} currentUid={session.uid} />;
}
