import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getBoothSummary, getSession, isBoothMember } from "@/lib/server/dal";
import { formatCents } from "@/lib/shared/money";

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

  const summary = await getBoothSummary(boothId);
  if (!summary) notFound();

  return (
    <div className="flex flex-col gap-6">
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

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">Item breakdown</h2>
        {summary.items.length === 0 ? (
          <p className="text-sm text-muted">No sales yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {summary.items.map((item) => (
              <li key={item.itemId} className="flex items-center justify-between gap-4 py-2">
                <span className="text-foreground">{item.name}</span>
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
