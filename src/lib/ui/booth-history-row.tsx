"use client";

import { TIMEZONE } from "@/lib/shared/constants";
import { formatCents } from "@/lib/shared/money";
import type { BoothHistoryEntry } from "@/lib/shared/types";

const STAMP_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function BoothHistoryRow({ entry }: { entry: BoothHistoryEntry }) {
  const refund = entry.type === "refund";
  const amount = refund ? formatCents(-entry.amountCents) : formatCents(entry.amountCents);

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{entry.buyerName}</span>
          {refund ? (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
              Refund
            </span>
          ) : null}
        </span>
        <span className={refund ? "font-semibold text-danger" : "font-semibold text-foreground"}>
          {amount}
        </span>
      </div>

      {entry.lineItems.length > 0 ? (
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

      <div className="flex items-baseline justify-between gap-4 text-xs text-muted">
        <time dateTime={entry.createdAt}>{STAMP_FORMAT.format(new Date(entry.createdAt))}</time>
        <span>by {entry.actorName}</span>
      </div>
    </li>
  );
}
