"use client";

import { formatCents } from "@/lib/shared/money";
import { type PendingCharge, PENDING_CHARGE_RETRY_WINDOW_MS } from "@/lib/ui/pending-charge";
import { useNow } from "@/lib/ui/use-now";
import { Button } from "@/lib/ui/vendor/button";

export const RECOVERY_TICK_MS = 10_000;

export function RecoveryCard({
  pending,
  busy = false,
  online = true,
  onRetry,
  onDismiss,
}: {
  pending: PendingCharge;
  busy?: boolean;
  online?: boolean;
  onRetry: (pending: PendingCharge) => void;
  onDismiss: () => void;
}) {
  const now = useNow(RECOVERY_TICK_MS);
  const retryable = now - pending.startedAt <= PENDING_CHARGE_RETRY_WINDOW_MS;

  return (
    <section
      role="alert"
      aria-label="Unfinished charge"
      className="flex flex-col gap-2 rounded-lg border-2 border-warning bg-surface p-4"
    >
      <p className="text-lg font-bold text-foreground">Did this charge go through?</p>
      <p className="text-base text-foreground">
        {formatCents(pending.amountCents)} to {pending.buyerName} may not have finished.
      </p>
      {retryable ? (
        <>
          <p className="text-sm text-muted">
            Retrying is safe — it either finishes the charge or reports the one that already went
            through. It cannot charge twice.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={() => onRetry(pending)} disabled={busy || !online}>
              {busy ? "Retrying…" : "Retry charge"}
            </Button>
            <Button type="button" variant="outline" onClick={onDismiss} disabled={busy}>
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            The buyer has almost certainly left by now — ask SAC to check the feed for this charge
            rather than retrying it here.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onDismiss} disabled={busy}>
              Dismiss
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
