"use client";

import { useMemo, useState } from "react";
import { formatCents, isValidAmount } from "@/lib/shared/money";
import type { BoothItem } from "@/lib/shared/types";
import { Button } from "@/lib/ui/vendor/button";
import type { PriceEdit } from "../api";

export function parseDollars(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  return isValidAmount(cents) ? cents : null;
}

function toDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function PriceEditor({
  items,
  submitLabel,
  busy,
  allowNoChange,
  onSubmit,
  onArchive,
}: {
  items: BoothItem[];
  submitLabel: string;
  busy: boolean;
  allowNoChange: boolean;
  onSubmit: (edits: PriceEdit[]) => void;
  onArchive?: (item: BoothItem) => void;
}) {
  const editable = useMemo(
    () => items.filter((item) => !item.isCustom && item.archived !== true),
    [items],
  );
  const custom = items.find((item) => item.isCustom && item.archived !== true);

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((item) => [item.id, toDollars(item.priceCents)])),
  );

  const parsed = editable.map((item) => ({ item, cents: parseDollars(draft[item.id] ?? "") }));
  const invalid = parsed.some((row) => row.cents === null);
  const edits: PriceEdit[] = parsed
    .filter((row) => row.cents !== null && row.cents !== row.item.priceCents)
    .map((row) => ({ id: row.item.id, priceCents: row.cents! }));

  const canSubmit = !busy && !invalid && (allowNoChange || edits.length > 0);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(edits);
      }}
    >
      <ul className="flex flex-col divide-y divide-border">
        {editable.map((item) => {
          const value = draft[item.id] ?? "";
          const bad = parseDollars(value) === null;
          return (
            <li key={item.id} className="flex items-center justify-between gap-4 py-3">
              <label htmlFor={`price-${item.id}`} className="font-medium text-foreground">
                {item.name}
              </label>
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span aria-hidden className="text-muted">
                    $
                  </span>
                  <input
                    id={`price-${item.id}`}
                    type="text"
                    inputMode="decimal"
                    value={value}
                    aria-label={`${item.name} price in dollars`}
                    aria-invalid={bad}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                    className={`h-11 w-24 rounded-md border bg-background px-3 text-right text-base text-foreground ${
                      bad ? "border-danger" : "border-border"
                    }`}
                  />
                </span>
                {onArchive ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    aria-label={`Archive ${item.name}`}
                    onClick={() => onArchive(item)}
                  >
                    Archive
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
        {custom ? (
          <li className="flex items-center justify-between gap-4 py-3">
            <span className="font-medium text-foreground">
              {custom.name} <span className="text-muted">· price locked</span>
            </span>
            <span className="text-base text-muted">{formatCents(custom.priceCents)}</span>
          </li>
        ) : null}
      </ul>

      {invalid ? (
        <p role="status" className="text-sm font-medium text-danger">
          Prices must be a positive multiple of $0.50.
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={!canSubmit}>
        {busy ? "Working…" : submitLabel}
      </Button>
    </form>
  );
}
