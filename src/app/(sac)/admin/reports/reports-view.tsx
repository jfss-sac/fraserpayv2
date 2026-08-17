"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { refreshEventReports } from "./actions";
import { LedgerExportControl } from "./ledger-export-control";
import { formatCents } from "@/lib/shared/money";
import type {
  BoothItemSummary,
  BoothReportRow,
  BoothStatus,
  BoothSummary,
  ReportsDTO,
} from "@/lib/shared/types";

const STATUS_LABEL: Record<BoothStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  deactivated: "Deactivated",
};

function BoothRow({ booth }: { booth: BoothReportRow }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BoothItemSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const detailId = `report-booth-${booth.boothId}`;

  async function loadItems(): Promise<void> {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/sac/booths/${booth.boothId}/summary`);
      if (!res.ok) throw new Error(String(res.status));
      setItems(((await res.json()) as BoothSummary).items);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle(): void {
    const next = !open;
    setOpen(next);
    if (next && items === null && !loading) void loadItems();
  }

  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={toggle}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <span className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 font-medium text-foreground">
            {booth.boothName}
            {booth.status === "deactivated" ? (
              <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs font-medium text-muted">
                {STATUS_LABEL[booth.status]}
              </span>
            ) : null}
          </span>
          <span className="text-sm text-muted">
            {booth.purchaseCount} sales · {booth.refundCount} refunds
          </span>
        </span>
        <span className="text-right">
          <span className="block font-semibold text-foreground">
            {formatCents(booth.grossCents)}
          </span>
          <span className="block text-xs text-muted">gross</span>
        </span>
      </button>

      {open ? (
        <div id={detailId} className="border-t border-border px-4 py-3">
          {loading ? (
            <p className="text-sm text-muted">Loading item breakdown…</p>
          ) : failed ? (
            <p className="flex items-center gap-3 text-sm text-muted">
              Couldn&apos;t load the item breakdown.
              <button
                type="button"
                onClick={() => void loadItems()}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground"
              >
                Retry
              </button>
            </p>
          ) : items === null || items.length === 0 ? (
            <p className="text-sm text-muted">No items sold yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li
                  key={item.itemId}
                  className="flex items-center justify-between gap-3 py-1.5 text-sm"
                >
                  <span className="text-foreground">
                    {item.name}
                    <span className="text-muted"> · {item.qty}</span>
                  </span>
                  <span className="font-medium text-foreground">
                    {formatCents(item.revenueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function ReportsView({
  data,
  canExportLedger = false,
}: {
  data: ReportsDTO;
  canExportLedger?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">Event reports</h1>
        <div className="flex items-center gap-2">
          <a
            href="/api/sac/reports/export"
            download
            className="h-10 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground"
          >
            Download CSV
          </a>
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                await refreshEventReports();
                router.refresh();
              })
            }
            disabled={pending}
            className="h-10 rounded-md border border-border px-4 text-sm font-medium text-foreground disabled:opacity-50"
          >
            {pending ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <p className="text-sm text-muted">
        Gross sales per booth are the basis for paying booths out in real money (purchases minus
        refunds). Outstanding liability is the unspent credit still owed to students.
      </p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border px-4 py-3">
          <dt className="text-sm text-muted">Gross sales</dt>
          <dd className="text-lg font-semibold text-foreground">
            {formatCents(data.grossTotalCents)}
          </dd>
        </div>
        <div className="rounded-lg border border-border px-4 py-3">
          <dt className="text-sm text-muted">Top-ups collected</dt>
          <dd className="text-lg font-semibold text-foreground">
            {formatCents(data.topups.totalCents)}
          </dd>
          <dd className="text-xs text-muted">
            {formatCents(data.topups.cashCents)} cash / {formatCents(data.topups.cardCents)} card
          </dd>
        </div>
        <div className="rounded-lg border border-border px-4 py-3">
          <dt className="text-sm text-muted">Outstanding liability</dt>
          <dd className="text-lg font-semibold text-foreground">
            {formatCents(data.outstandingLiabilityCents)}
          </dd>
        </div>
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Booth payout basis
        </h2>
        {data.booths.length === 0 ? (
          <p className="text-sm text-muted">No booths with sales yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.booths.map((booth) => (
              <BoothRow
                key={`${booth.boothId}:${booth.grossCents}:${booth.purchaseCount}:${booth.refundCount}`}
                booth={booth}
              />
            ))}
          </ul>
        )}
      </section>

      {canExportLedger ? <LedgerExportControl /> : null}
    </div>
  );
}
