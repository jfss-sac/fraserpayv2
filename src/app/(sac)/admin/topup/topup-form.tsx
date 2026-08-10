"use client";

import { useCallback, useState } from "react";
import { CENT_STEP } from "@/lib/shared/constants";
import {
  exceedsBalanceCap,
  exceedsTopupCap,
  formatCents,
  isValidAmount,
  pointsFor,
  requiresReconfirm,
} from "@/lib/shared/money";
import type { PaymentMethod, SacLookupResult, TopUpResult } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { Scanner, type BuyerId } from "@/lib/ui/scanner";
import { Toaster, useToasts } from "@/lib/ui/toast";
import { Button } from "@/lib/ui/vendor/button";
import { Card, CardContent } from "@/lib/ui/vendor/card";
import { ReconfirmDialog } from "./reconfirm-dialog";
import { lookupErrorMessage, requestSacLookup, topUpErrorMessage, useTopUp } from "./use-topup";

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export function parseAmountCents(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number.parseFloat(trimmed) * 100);
  return isValidAmount(cents) ? cents : null;
}

function formatDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

type Stage = "identify" | "looking-up" | "confirm" | "amount";

function StudentSummary({ student }: { student: SacLookupResult }) {
  return (
    <p className="text-sm text-muted">
      Current balance{" "}
      <span className="font-medium text-foreground">{formatCents(student.balanceCents)}</span> ·{" "}
      {student.points} points
    </p>
  );
}

function SuccessPanel({
  result,
  name,
  onReset,
}: {
  result: TopUpResult;
  name: string | null;
  onReset: () => void;
}) {
  return (
    <Card>
      <CardContent className="gap-4">
        <p role="status" className="text-lg font-semibold text-foreground">
          Topped up {name ?? "student"}
        </p>
        <dl className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <dt className="text-sm text-muted">Added</dt>
            <dd className="text-base font-medium text-foreground">
              {formatCents(result.amountCents)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-sm text-muted">New balance</dt>
            <dd className="text-2xl font-bold text-foreground">
              {formatCents(result.balanceAfterCents)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-sm text-muted">Points granted</dt>
            <dd className="text-base font-medium text-foreground">
              +{pointsFor(result.amountCents)} ({result.points} total)
            </dd>
          </div>
        </dl>
        <Button type="button" size="lg" onClick={onReset}>
          New top-up
        </Button>
      </CardContent>
    </Card>
  );
}

export function TopUpForm({ isExec }: { isExec: boolean }) {
  const { toasts, push, dismiss } = useToasts();
  const [buyer, setBuyer] = useState<BuyerId | null>(null);
  const [student, setStudent] = useState<SacLookupResult | null>(null);
  const [stage, setStage] = useState<Stage>("identify");
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [overrideReason, setOverrideReason] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const {
    state,
    submit,
    reset: resetTopUp,
  } = useTopUp({
    onSuccess: () => setDialogOpen(false),
    onError: (code, serverMessage) => {
      setDialogOpen(false);
      push(topUpErrorMessage(code, serverMessage), "error");
    },
  });

  const reset = useCallback(() => {
    setBuyer(null);
    setStudent(null);
    setStage("identify");
    setAmountText("");
    setMethod("cash");
    setOverrideReason("");
    setDialogOpen(false);
    resetTopUp();
  }, [resetTopUp]);

  const handleIdentify = useCallback(
    (identified: BuyerId) => {
      setBuyer(identified);
      setStage("looking-up");
      requestSacLookup(identified)
        .then((result) => {
          setStudent(result);
          setStage("confirm");
        })
        .catch((err) => {
          push(lookupErrorMessage(err instanceof ApiError ? err.code : "NETWORK"), "error");
          setBuyer(null);
          setStage("identify");
        });
    },
    [push],
  );

  const amountCents = parseAmountCents(amountText);
  const resultingBalance =
    student && amountCents !== null ? student.balanceCents + amountCents : null;
  const capsExceeded =
    amountCents !== null &&
    (exceedsTopupCap(amountCents) ||
      (resultingBalance !== null && exceedsBalanceCap(resultingBalance)));
  const showOverride = isExec && capsExceeded;
  const submitting = state.status === "pending";
  const canSubmit =
    amountCents !== null && !submitting && (!showOverride || overrideReason.trim().length > 0);

  const doSubmit = useCallback(() => {
    if (!buyer || amountCents === null) return;
    submit({
      buyer,
      amountCents,
      method,
      ...(showOverride && overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
    });
  }, [buyer, amountCents, method, showOverride, overrideReason, submit]);

  const beginSubmit = useCallback(() => {
    if (!canSubmit || amountCents === null) return;
    if (requiresReconfirm(amountCents)) {
      setDialogOpen(true);
      return;
    }
    doSubmit();
  }, [canSubmit, amountCents, doSubmit]);

  const step = useCallback((delta: number) => {
    setAmountText((current) => {
      const base = parseAmountCents(current) ?? 0;
      return formatDollars(Math.max(CENT_STEP, base + delta));
    });
  }, []);

  const typed = buyer !== null && "studentNumber" in buyer;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-foreground">Top-up</h1>

      {state.status === "success" ? (
        <SuccessPanel result={state.result} name={student?.name ?? null} onReset={reset} />
      ) : stage === "identify" ? (
        <Scanner onIdentify={handleIdentify} manualEntry="studentNumber" />
      ) : stage === "looking-up" ? (
        <p role="status" className="text-base text-muted">
          Looking up student…
        </p>
      ) : stage === "confirm" && student ? (
        <Card>
          <CardContent className="gap-4">
            <p className="text-xl font-semibold text-foreground">Is this {student.name}?</p>
            <StudentSummary student={student} />
            {typed && <p className="text-sm text-muted">Ask for their student card to confirm.</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" size="lg" onClick={() => setStage("amount")}>
                Yes, top up
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={reset}>
                Not them — start over
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : stage === "amount" && student ? (
        <Card>
          <CardContent className="gap-5">
            <div className="flex flex-col gap-1">
              <p className="text-base font-semibold text-foreground">Topping up {student.name}</p>
              <StudentSummary student={student} />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="topup-amount" className="text-sm font-medium text-foreground">
                Amount
              </label>
              <div className="flex items-center gap-2">
                <span aria-hidden className="text-2xl font-bold text-muted">
                  $
                </span>
                <input
                  id="topup-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value.replace(/[^\d.]/g, ""))}
                  aria-label="Top-up amount in dollars"
                  className="h-14 w-full rounded-md border border-border bg-background px-4 text-3xl font-bold tracking-wide text-foreground"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => step(-CENT_STEP)}
                  aria-label="Subtract 50 cents"
                >
                  − $0.50
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => step(CENT_STEP)}
                  aria-label="Add 50 cents"
                >
                  + $0.50
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map((cents) => (
                  <Button
                    key={cents}
                    type="button"
                    variant="outline"
                    onClick={() => setAmountText(formatDollars(cents))}
                  >
                    {formatCents(cents)}
                  </Button>
                ))}
              </div>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">Payment method</legend>
              <div className="flex gap-2">
                {(["cash", "card"] as const).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={method === option ? "default" : "outline"}
                    aria-pressed={method === option}
                    className="flex-1 capitalize"
                    onClick={() => setMethod(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </fieldset>

            {capsExceeded && !isExec && (
              <p role="status" className="text-sm font-medium text-danger">
                Over the $100 top-up / $200 balance cap — only an exec can override.
              </p>
            )}

            {showOverride && (
              <div className="flex flex-col gap-2">
                <label htmlFor="override-reason" className="text-sm font-medium text-foreground">
                  Reason for override
                </label>
                <textarea
                  id="override-reason"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  rows={2}
                  maxLength={280}
                  className="rounded-md border border-border bg-background px-3 py-2 text-base text-foreground"
                  placeholder="This top-up exceeds the caps because…"
                />
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                size="lg"
                className="sm:flex-1"
                onClick={beginSubmit}
                disabled={!canSubmit}
              >
                {amountCents !== null ? `Top up ${formatCents(amountCents)}` : "Top up"}
              </Button>
              <Button type="button" variant="outline" size="lg" onClick={reset}>
                Start over
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dialogOpen && amountCents !== null && student && (
        <ReconfirmDialog
          amountCents={amountCents}
          name={student.name}
          busy={submitting}
          onConfirm={doSubmit}
          onCancel={() => setDialogOpen(false)}
        />
      )}

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
