import { notFound, redirect } from "next/navigation";
import { getSession, hasAnyBoothMembership } from "@/lib/server/dal";
import { AppShell, buildModes } from "@/lib/ui/shell";

export default async function BoothLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const hasBooth = await hasAnyBoothMembership(session.uid);
  if (session.suspended || !hasBooth) notFound();

  const modes = buildModes(session.roles, hasBooth);

  return (
    <AppShell active="sell" modes={modes} suspended={session.suspended}>
      {children}
    </AppShell>
  );
}
