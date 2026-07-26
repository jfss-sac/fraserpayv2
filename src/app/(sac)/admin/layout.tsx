import { notFound } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { AdminNav } from "./admin-nav";
import { ADMIN_NAV, visibleNav } from "./nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.suspended || !(session.roles.sacMember || session.roles.sacExec)) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminNav items={visibleNav(ADMIN_NAV, session.roles)} />
      <div>{children}</div>
    </div>
  );
}
