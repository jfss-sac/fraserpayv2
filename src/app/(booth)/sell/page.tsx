import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, listMemberBooths } from "@/lib/server/dal";
import { buttonVariants } from "@/lib/ui/vendor/button";

export const metadata: Metadata = {
  title: "Sell",
};

export default async function SellPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const booths = await listMemberBooths(session.uid);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Sell</h1>
        <p className="text-sm text-muted">Choose a booth to open its point of sale.</p>
      </div>

      {booths.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-foreground">You&apos;re not a member of any booth yet.</p>
          <Link href="/booths/join" className={buttonVariants({ variant: "outline" })}>
            Join a booth
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {booths.map((booth) => {
            const sellable = booth.status === "approved";
            return (
              <li key={booth.id}>
                {sellable ? (
                  <Link
                    href={`/sell/${booth.id}`}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-4 text-foreground"
                  >
                    <span className="font-medium">{booth.name}</span>
                    <span aria-hidden className="text-muted">
                      →
                    </span>
                  </Link>
                ) : (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface px-4 py-4 opacity-60">
                    <span className="font-medium text-foreground">{booth.name}</span>
                    <span className="text-sm text-muted">
                      {booth.status === "pending" ? "Awaiting approval" : "Deactivated"}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
