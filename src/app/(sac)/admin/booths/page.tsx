import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { listBooths } from "@/lib/server/sac-booths";
import { BoothList } from "./booth-list";

export const metadata: Metadata = {
  title: "Booths",
};

export default async function BoothsPage() {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  const booths = await listBooths();

  return <BoothList booths={booths} isExec={session.roles.sacExec} />;
}
