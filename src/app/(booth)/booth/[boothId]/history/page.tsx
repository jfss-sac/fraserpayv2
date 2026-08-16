import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSession, isBoothMember } from "@/lib/server/dal";
import { BoothTabs } from "@/lib/ui/booth-tabs";
import { BoothHistoryView } from "./history-view";

export const metadata: Metadata = {
  title: "Booth history",
};

export default async function BoothHistoryPage({
  params,
}: {
  params: Promise<{ boothId: string }>;
}) {
  const { boothId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isBoothMember(boothId, session.uid))) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BoothTabs boothId={boothId} active="history" isMember />
      <BoothHistoryView boothId={boothId} />
    </div>
  );
}
