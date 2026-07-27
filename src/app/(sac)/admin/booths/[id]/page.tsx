import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { getBoothDetail } from "@/lib/server/sac-booths";
import { BoothManage } from "./booth-manage";

export const metadata: Metadata = {
  title: "Booth",
};

export default async function BoothDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  const detail = await getBoothDetail(id);
  if (!detail) notFound();

  return <BoothManage detail={detail} isExec={session.roles.sacExec} />;
}
