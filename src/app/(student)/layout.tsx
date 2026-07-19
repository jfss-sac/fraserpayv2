import { redirect } from "next/navigation";
import { getSession, hasAnyBoothMembership } from "@/lib/server/dal";
import { AppShell, buildModes } from "@/lib/ui/shell";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const modes = buildModes(session.roles, await hasAnyBoothMembership(session.uid));

  return (
    <AppShell active="student" modes={modes} suspended={session.suspended}>
      {children}
    </AppShell>
  );
}
