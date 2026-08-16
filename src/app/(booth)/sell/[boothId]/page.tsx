import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getBoothCatalog, getSession, isBoothMember, isBoothOperator } from "@/lib/server/dal";
import { BoothTabs } from "@/lib/ui/booth-tabs";
import { PosTerminal } from "./pos-terminal";

export const metadata: Metadata = {
  title: "Point of sale",
};

export default async function PosPage({ params }: { params: Promise<{ boothId: string }> }) {
  const { boothId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isBoothOperator(boothId, session))) notFound();

  const [booth, member] = await Promise.all([
    getBoothCatalog(boothId),
    isBoothMember(boothId, session.uid),
  ]);
  if (!booth) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BoothTabs boothId={boothId} active="sell" isMember={member} />

      <h1 className="text-2xl font-bold text-foreground">{booth.name}</h1>

      {booth.status === "approved" ? (
        <PosTerminal boothId={booth.id} actorUid={session.uid} items={booth.items} />
      ) : (
        <p role="status" className="text-sm text-muted">
          This booth can&apos;t sell yet. It&apos;s{" "}
          {booth.status === "pending" ? "awaiting SAC approval" : "deactivated"}.
        </p>
      )}
    </div>
  );
}
