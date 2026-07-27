"use client";

import { useCallback, useState } from "react";
import { TIMEZONE } from "@/lib/shared/constants";
import { formatCents } from "@/lib/shared/money";
import type { SacLedgerEntry } from "@/lib/shared/types";
import { Button } from "@/lib/ui/vendor/button";
import { ledgerErrorMessage, requestStudentLedger, StudentsApiError } from "../api";

const STAMP_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatStamp(iso: string): string {
  return STAMP_FORMAT.format(new Date(iso));
}

function entryTitle(entry: SacLedgerEntry): string {
  switch (entry.type) {
    case "purchase":
      return entry.boothName ?? "Purchase";
    case "refund":
      return entry.boothName ? `Refund · ${entry.boothName}` : "Refund";
    case "topup":
      return entry.method ? `Top-up · ${entry.method === "cash" ? "Cash" : "Card"}` : "Top-up";
    case "adjustment":
      return "Adjustment";
  }
}

function LedgerRow({
  entry,
  onRefund,
}: {
  entry: SacLedgerEntry;
  onRefund?: (entry: SacLedgerEntry) => void;
}) {
  const credit = entry.direction === "credit";
  const amount = credit ? `+${formatCents(entry.amountCents)}` : formatCents(-entry.amountCents);
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{entryTitle(entry)}</span>
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
            >
              {tag}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-3">
          {onRefund && entry.type === "purchase" ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-auto px-3 text-sm"
              onClick={() => onRefund(entry)}
            >
              Refund
            </Button>
          ) : null}
          <span className={credit ? "font-semibold text-success" : "font-semibold text-foreground"}>
            {amount}
          </span>
        </span>
      </div>
      {entry.lineItems && entry.lineItems.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-sm text-muted">
          {entry.lineItems.map((line, index) => (
            <li key={`${line.itemId}-${index}`} className="flex justify-between gap-4">
              <span>
                {line.name} × {line.qty} @ {formatCents(line.unitPriceCents)}
              </span>
              <span>{formatCents(line.qty * line.unitPriceCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {entry.reason ? <p className="text-sm text-muted">{entry.reason}</p> : null}
      <div className="flex items-baseline justify-between gap-4 text-xs text-muted">
        <time dateTime={entry.createdAt}>{formatStamp(entry.createdAt)}</time>
        <span>
          by {entry.actorName} · balance {formatCents(entry.balanceAfterCents)}
        </span>
      </div>
    </li>
  );
}

export function StudentLedger({
  studentUid,
  initialEntries,
  initialCursor,
  onRefund,
}: {
  studentUid: string;
  initialEntries: SacLedgerEntry[];
  initialCursor: string | null;
  onRefund?: (entry: SacLedgerEntry) => void;
}) {
  const [entries, setEntries] = useState<SacLedgerEntry[]>(initialEntries);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || cursor === null) return;
    setLoading(true);
    setError(null);
    try {
      const dto = await requestStudentLedger(studentUid, cursor);
      setEntries((prev) => [...prev, ...dto.entries]);
      setCursor(dto.nextCursor);
    } catch (err) {
      const code = err instanceof StudentsApiError ? err.code : "NETWORK";
      setError(ledgerErrorMessage(code));
    } finally {
      setLoading(false);
    }
  }, [loading, cursor, studentUid]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-foreground">Ledger</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">No transactions yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {entries.map((entry) => (
            <LedgerRow key={entry.id} entry={entry} onRefund={onRefund} />
          ))}
        </ul>
      )}

      {error ? (
        <p role="status" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      {cursor !== null ? (
        <Button type="button" variant="outline" onClick={loadMore} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </section>
  );
}
