"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCents } from "@/lib/shared/money";
import type { SacLedgerEntry } from "@/lib/shared/types";
import { Button } from "@/lib/ui/vendor/button";

interface AggLine {
  itemId: string;
  name: string;
  unitPriceCents: number;
  qty: number;
}

function aggregateLines(entry: SacLedgerEntry): AggLine[] {
  const byItem = new Map<string, AggLine>();
  for (const line of entry.lineItems ?? []) {
    const existing = byItem.get(line.itemId);
    if (existing) existing.qty += line.qty;
    else
      byItem.set(line.itemId, {
        itemId: line.itemId,
        name: line.name,
        unitPriceCents: line.unitPriceCents,
        qty: line.qty,
      });
  }
  return [...byItem.values()];
}

export function RefundDialog({
  entry,
  busy,
  onSubmit,
  onCancel,
}: {
  entry: SacLedgerEntry;
  busy: boolean;
  onSubmit: (input: {
    originalEntryId: string;
    reason: string;
    lineItems?: { itemId: string; qty: number }[];
  }) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const lines = useMemo(() => aggregateLines(entry), [entry]);
  const [full, setFull] = useState(true);
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((line) => [line.itemId, line.qty])),
  );
  const [reason, setReason] = useState("");

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, busy]);

  const selectedTotal = full
    ? entry.amountCents
    : lines.reduce((sum, line) => sum + (qty[line.itemId] ?? 0) * line.unitPriceCents, 0);
  const hasSelection = full || lines.some((line) => (qty[line.itemId] ?? 0) > 0);
  const canSubmit = hasSelection && reason.trim().length > 0 && !busy;

  function setLineQty(itemId: string, next: number, max: number) {
    setQty((current) => ({ ...current, [itemId]: Math.max(0, Math.min(max, next)) }));
  }

  function submit() {
    if (!hasSelection || reason.trim().length === 0) return;
    if (full) {
      onSubmit({ originalEntryId: entry.id, reason: reason.trim() });
      return;
    }
    const lineItems = lines
      .filter((line) => (qty[line.itemId] ?? 0) > 0)
      .map((line) => ({ itemId: line.itemId, qty: qty[line.itemId]! }));
    onSubmit({ originalEntryId: entry.id, reason: reason.trim(), lineItems });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-background p-6 shadow-xl"
      >
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            Refund {entry.boothName ?? "purchase"}
          </h2>
          <p className="text-sm text-muted">Original charge {formatCents(entry.amountCents)}</p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Scope</legend>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={full ? "default" : "outline"}
              aria-pressed={full}
              className="flex-1"
              onClick={() => setFull(true)}
            >
              Full refund
            </Button>
            <Button
              type="button"
              variant={full ? "outline" : "default"}
              aria-pressed={!full}
              className="flex-1"
              onClick={() => setFull(false)}
            >
              Per item
            </Button>
          </div>
        </fieldset>

        {!full ? (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li
                key={line.itemId}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-foreground">{line.name}</span>
                  <span className="text-sm text-muted">
                    {formatCents(line.unitPriceCents)} · bought {line.qty}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Refund one fewer ${line.name}`}
                    onClick={() => setLineQty(line.itemId, (qty[line.itemId] ?? 0) - 1, line.qty)}
                  >
                    −
                  </Button>
                  <span
                    aria-label={`${line.name} refund quantity`}
                    className="w-6 text-center text-lg font-semibold text-foreground"
                  >
                    {qty[line.itemId] ?? 0}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Refund one more ${line.name}`}
                    onClick={() => setLineQty(line.itemId, (qty[line.itemId] ?? 0) + 1, line.qty)}
                  >
                    +
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor="refund-reason" className="text-sm font-medium text-foreground">
            Reason
          </label>
          <textarea
            id="refund-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={280}
            className="rounded-md border border-border bg-background px-3 py-2 text-base text-foreground"
            placeholder="Why is this being refunded?"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            type="button"
            size="lg"
            className="sm:flex-1"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy
              ? "Refunding…"
              : full
                ? "Refund remaining"
                : `Refund ${formatCents(selectedTotal)}`}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="sm:flex-1"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
