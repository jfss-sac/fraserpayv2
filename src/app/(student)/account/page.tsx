import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, listMemberBooths, type Session } from "@/lib/server/dal";
import { SignOutButton } from "@/lib/ui/sign-out-button";
import { HelpSection } from "./help-section";

export const metadata: Metadata = {
  title: "Account",
};

function roleLabels(session: Session): string[] {
  return [
    session.studentNumber === null ? "Teacher" : "Student",
    ...(session.roles.sacMember ? ["SAC member"] : []),
    ...(session.roles.sacExec ? ["SAC exec"] : []),
  ];
}

function boothStatus(status: "pending" | "approved" | "deactivated"): string | null {
  if (status === "pending") return "Awaiting approval";
  if (status === "deactivated") return "Deactivated";
  return null;
}

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const booths = await listMemberBooths(session.uid);
  const externalHelpUrl = process.env.ACCOUNT_HELP_URL?.trim() || undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Account</h1>
        <p className="text-sm text-muted">Your FraserPay identity and access.</p>
      </div>

      <section aria-labelledby="identity-heading" className="flex flex-col gap-3">
        <h2 id="identity-heading" className="text-lg font-semibold text-foreground">
          Identity
        </h2>
        <dl className="divide-y divide-border rounded-lg border border-border bg-surface">
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-sm text-muted">Display name</dt>
            <dd className="font-medium text-foreground sm:text-right">{session.displayName}</dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-sm text-muted">Student number</dt>
            <dd className="font-medium text-foreground sm:text-right">
              {session.studentNumber ?? "No student number"}
            </dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-sm text-muted">Email</dt>
            <dd className="break-all font-medium text-foreground sm:text-right">{session.email}</dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4">
            <dt className="text-sm text-muted">Roles</dt>
            <dd>
              <ul className="flex flex-wrap gap-2 sm:justify-end">
                {roleLabels(session).map((role) => (
                  <li
                    key={role}
                    className="rounded-full bg-muted px-2.5 py-1 text-sm text-foreground"
                  >
                    {role}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="booths-heading" className="flex flex-col gap-3">
        <h2 id="booths-heading" className="text-lg font-semibold text-foreground">
          Booth memberships
        </h2>
        {booths.length === 0 ? (
          <p className="text-sm text-muted">You&apos;re not a member of any booth yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {booths.map((booth) => {
              const status = boothStatus(booth.status);
              return (
                <li key={booth.id}>
                  <Link
                    href={`/booth/${booth.id}`}
                    className="flex min-h-11 items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-2 text-foreground"
                  >
                    <span className="font-medium">{booth.name}</span>
                    {status ? <span className="text-sm text-muted">{status}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <HelpSection externalHelpUrl={externalHelpUrl} />

      <div className="border-t border-border pt-6">
        <SignOutButton />
      </div>
    </div>
  );
}
