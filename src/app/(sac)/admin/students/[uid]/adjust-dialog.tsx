"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CENT_STEP } from "@/lib/shared/constants";
import { formatCents, pointsFor } from "@/lib/shared/money";
import { Button } from "@/lib/ui/vendor/button";

export interface LinkableTopUp {
  id: string;
  label: string;
}

export function parseDollarsToCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  if (cents <= 0 || cents % CENT_STEP !== 0) return null;
  return cents;
}

export function pointsPreview(currentPoints: number, signedCents: number): number {
  const after = Math.max(0, currentPoints + pointsFor(signedCents));
  return after - currentPoints;
}

export function AdjustDialog({
  studentName,
  currentPoints,
  topups,
  busy,
  onSubmit,
  onCancel,
}: {
  studentName: string;
  currentPoints: number;
  topups: LinkableTopUp[];
  busy: boolean;
  onSubmit: (input: { amountCents: number; reason: string; originalEntryId?: string }) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [linkedId, setLinkedId] = useState("");

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, busy]);

  const magnitude = parseDollarsToCents(amountText);
  const signedCents = magnitude === null ? null : direction === "remove" ? -magnitude : magnitude;
  const preview = useMemo(
    () => (signedCents !== null && linkedId ? pointsPreview(currentPoints, signedCents) : null),
    [signedCents, linkedId, currentPoints],
  );
  const canSubmit = signedCents !== null && reason.trim().length > 0 && !busy;

  function submit() {
    if (signedCents === null || reason.trim().length === 0) return;
    onSubmit({
      amountCents: signedCents,
      reason: reason.trim(),
      ...(linkedId ? { originalEntryId: linkedId } : {}),
    });
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
        <h2 id={titleId} className="text-lg font-semibold text-foreground">
          Adjust {studentName}&rsquo;s balance
        </h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Direction</legend>
          <div className="flex gap-2">
            {(["add", "remove"] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={direction === option ? "default" : "outline"}
                aria-pressed={direction === option}
                className="flex-1 capitalize"
                onClick={() => {
                  setDirection(option);
                  if (option === "add") setLinkedId("");
                }}
              >
                {option === "add" ? "Add credit" : "Remove credit"}
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor="adjust-amount" className="text-sm font-medium text-foreground">
            Amount
          </label>
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-2xl font-bold text-muted">
              $
            </span>
            <input
              id="adjust-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value.replace(/[^\d.]/g, ""))}
              aria-label="Adjustment amount in dollars"
              className="h-12 w-full rounded-md border border-border bg-background px-4 text-2xl font-bold tracking-wide text-foreground"
            />
          </div>
          {signedCents !== null ? (
            <p className="text-sm text-muted">
              Balance change{" "}
              <span className="font-medium text-foreground">
                {signedCents > 0 ? `+${formatCents(signedCents)}` : formatCents(signedCents)}
              </span>
            </p>
          ) : null}
        </div>

        {topups.length > 0 && direction === "remove" ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="adjust-link" className="text-sm font-medium text-foreground">
              Link to a top-up (reverses its points)
            </label>
            <select
              id="adjust-link"
              value={linkedId}
              onChange={(event) => setLinkedId(event.target.value)}
              className="h-11 rounded-md border border-border bg-background px-3 text-base text-foreground"
            >
              <option value="">Not linked</option>
              {topups.map((topup) => (
                <option key={topup.id} value={topup.id}>
                  {topup.label}
                </option>
              ))}
            </select>
            {preview !== null ? (
              <p role="status" className="text-sm text-muted">
                Points change{" "}
                <span className="font-medium text-foreground">
                  {preview >= 0 ? `+${preview}` : preview}
                </span>{" "}
                ({Math.max(0, currentPoints + preview)} total)
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <label htmlFor="adjust-reason" className="text-sm font-medium text-foreground">
            Reason
          </label>
          <textarea
            id="adjust-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={280}
            className="rounded-md border border-border bg-background px-3 py-2 text-base text-foreground"
            placeholder="Why is this adjustment being made?"
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
            {busy ? "Adjusting…" : "Apply adjustment"}
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
