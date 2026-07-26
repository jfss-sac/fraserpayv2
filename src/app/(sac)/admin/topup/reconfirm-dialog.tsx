"use client";

import { useEffect, useRef } from "react";
import { formatCents } from "@/lib/shared/money";
import { centsToWords } from "@/lib/shared/number-to-words";
import { Button } from "@/lib/ui/vendor/button";

export function ReconfirmDialog({
  amountCents,
  name,
  busy,
  onConfirm,
  onCancel,
}: {
  amountCents: number;
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconfirm-title"
        aria-describedby="reconfirm-words"
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
      >
        <h2 id="reconfirm-title" className="text-lg font-semibold text-foreground">
          Confirm this top-up
        </h2>
        <p className="mt-4 text-4xl font-bold text-foreground">{formatCents(amountCents)}</p>
        <p id="reconfirm-words" className="mt-1 text-base text-muted">
          {centsToWords(amountCents)} to <span className="font-medium text-foreground">{name}</span>
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="button" size="lg" className="sm:flex-1" onClick={onConfirm} disabled={busy}>
            {busy ? "Topping up…" : `Confirm ${formatCents(amountCents)}`}
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
