import { notFound, redirect } from "next/navigation";
import { getSession, hasAnyBoothMembership } from "@/lib/server/dal";
import { AppShell, buildModes } from "@/lib/ui/shell";

export default async function SacLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const isSac = session.roles.sacMember || session.roles.sacExec;
  if (session.suspended || !isSac) notFound();

  const modes = buildModes(session.roles, await hasAnyBoothMembership(session.uid));

  return (
    <AppShell active="admin" modes={modes} suspended={session.suspended}>
      {children}
    </AppShell>
  );
}
