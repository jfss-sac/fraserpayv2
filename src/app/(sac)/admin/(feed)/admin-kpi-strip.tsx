import { formatCents } from "@/lib/shared/money";
import type { AdminKpiDTO } from "@/lib/server/sac-reports";

const KPI_ITEMS = [
  { key: "transactionsToday", label: "Transactions today" },
  { key: "activeBooths", label: "Active booths" },
  { key: "accounts", label: "Accounts" },
] as const;

export function AdminKpiStrip({ data }: { data: AdminKpiDTO }) {
  return (
    <section aria-label="Admin summary" className="rounded-lg border border-border bg-surface p-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {KPI_ITEMS.map((item) => (
          <div key={item.key} className="rounded-md bg-background px-3 py-2">
            <dt className="text-sm text-muted">{item.label}</dt>
            <dd className="text-xl font-semibold text-foreground">{data[item.key]}</dd>
          </div>
        ))}
        <div className="rounded-md bg-background px-3 py-2">
          <dt className="text-sm text-muted">Gross revenue</dt>
          <dd className="text-xl font-semibold text-foreground">
            {formatCents(data.grossRevenueCents)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
