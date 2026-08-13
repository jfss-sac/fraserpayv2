"use client";

import { formatCents } from "@/lib/shared/money";
import { type PendingTopUp, PENDING_TOPUP_RETRY_WINDOW_MS } from "@/lib/ui/pending-topup";
import { useNow } from "@/lib/ui/use-now";
import { Button } from "@/lib/ui/vendor/button";

export const TOPUP_RECOVERY_TICK_MS = 10_000;

export function TopUpRecoveryCard({
  pending,
  busy = false,
  onRetry,
  onDismiss,
}: {
  pending: PendingTopUp;
  busy?: boolean;
  onRetry: (pending: PendingTopUp) => void;
  onDismiss: () => void;
}) {
  const now = useNow(TOPUP_RECOVERY_TICK_MS);
  const retryable = now - pending.startedAt <= PENDING_TOPUP_RETRY_WINDOW_MS;

  return (
    <section
      role="alert"
      aria-label="Unfinished top-up"
      className="flex flex-col gap-2 rounded-lg border-2 border-warning bg-surface p-4"
    >
      <p className="text-lg font-bold text-foreground">Did this top-up go through?</p>
      <p className="text-base text-foreground">
        {formatCents(pending.amountCents)} for {pending.studentName} may not have finished.
      </p>
      {retryable ? (
        <>
          <p className="text-sm text-muted">
            Retrying is safe — it either finishes the top-up or reports the one that already went
            through. It cannot top up twice. Do not re-enter it by hand: only Retry can reuse the
            original key.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={() => onRetry(pending)} disabled={busy}>
              {busy ? "Retrying…" : "Retry top-up"}
            </Button>
            <Button type="button" variant="outline" onClick={onDismiss} disabled={busy}>
              Dismiss
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Too long has passed to retry safely — check the feed for this top-up before adding it
            again.
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
