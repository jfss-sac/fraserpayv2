import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBoothCatalog, getBoothSummary, getSession, isBoothMember } from "@/lib/server/dal";
import { formatCents } from "@/lib/shared/money";
import { BoothTabs } from "@/lib/ui/booth-tabs";
import { buttonVariants } from "@/lib/ui/vendor/button";

export const metadata: Metadata = {
  title: "Booth totals",
};

export default async function BoothSummaryPage({
  params,
}: {
  params: Promise<{ boothId: string }>;
}) {
  const { boothId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isBoothMember(boothId, session.uid))) notFound();

  const [summary, catalog] = await Promise.all([
    getBoothSummary(boothId),
    getBoothCatalog(boothId),
  ]);
  if (!summary) notFound();
  const stillSold = catalog ? new Set(catalog.items.map((item) => item.id)) : null;

  return (
    <div className="flex flex-col gap-6">
      <BoothTabs boothId={boothId} active="dashboard" isMember />

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">{summary.boothName}</h1>
        <p className="text-sm text-muted">
          {summary.purchaseCount} {summary.purchaseCount === 1 ? "sale" : "sales"}
          {summary.refundCount > 0
            ? ` · ${summary.refundCount} ${summary.refundCount === 1 ? "refund" : "refunds"}`
            : ""}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">Gross sales</span>
        <span className="text-4xl font-bold text-foreground">
          {formatCents(summary.grossCents)}
        </span>
      </div>

      {summary.status === "approved" ? (
        <Link href={`/sell/${boothId}`} className={buttonVariants({ size: "lg" })}>
          Process a sale
        </Link>
      ) : (
        <p className="text-sm text-muted">
          {summary.status === "pending"
            ? "Awaiting SAC approval — this booth can't sell yet."
            : "This booth is deactivated and can't sell."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">Item breakdown</h2>
        {summary.items.length === 0 ? (
          <p className="text-sm text-muted">No sales yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {summary.items.map((item) => (
              <li key={item.itemId} className="flex items-center justify-between gap-4 py-2">
                <span className="text-foreground">
                  {item.name}
                  {stillSold && !stillSold.has(item.itemId) ? (
                    <span className="text-muted"> (archived)</span>
                  ) : null}
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="text-sm text-muted">× {item.qty}</span>
                  <span className="font-medium text-foreground">
                    {formatCents(item.revenueCents)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
