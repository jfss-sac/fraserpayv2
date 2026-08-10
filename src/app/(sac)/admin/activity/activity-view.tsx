"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { TIMEZONE } from "@/lib/shared/constants";
import type { ActivityActor, ActivityDTO, ActivityScopeUsage } from "@/lib/shared/types";
import { Button } from "@/lib/ui/vendor/button";
import { adminActionErrorMessage, execSuspend } from "../students/[uid]/actions-api";
import { ConfirmDialog } from "../students/[uid]/confirm-dialog";

const LAST_SEEN_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function windowLabel(windowMs: number): string {
  const minutes = Math.round(windowMs / 60_000);
  return minutes === 1 ? "min" : `${minutes} min`;
}

function ScopeRow({ usage }: { usage: ActivityScopeUsage }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-foreground">
        {usage.scope}
        {usage.blockedWindows > 0 ? (
          <span className="text-danger"> · {usage.blockedWindows} blocked</span>
        ) : null}
      </span>
      <span className="text-muted">
        peak {usage.peakRequests} / {windowLabel(usage.windowMs)}
        <span className="text-muted/70"> (cap {usage.limit})</span>
      </span>
    </li>
  );
}

function ActorRow({
  actor,
  isExec,
  isSelf,
  onSuspend,
}: {
  actor: ActivityActor;
  isExec: boolean;
  isSelf: boolean;
  onSuspend: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <Link
            href={`/admin/students/${actor.uid}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {actor.displayName}
          </Link>
          <span className="text-sm text-muted">
            {actor.totalRequests} requests · last seen{" "}
            {LAST_SEEN_FORMAT.format(new Date(actor.lastSeenIso))}
            {actor.suspended ? " · suspended" : ""}
          </span>
        </span>
        <span className="text-right">
          <span
            className={`block font-semibold ${
              actor.blockedWindows > 0 ? "text-danger" : "text-foreground"
            }`}
          >
            {actor.peakRequests}
          </span>
          <span className="block text-xs text-muted">peak / window</span>
        </span>
      </div>

      <ul className="divide-y divide-border border-t border-border">
        {actor.scopes.map((usage) => (
          <ScopeRow key={usage.scope} usage={usage} />
        ))}
      </ul>

      {isExec && !actor.suspended && !isSelf ? (
        <Button type="button" variant="outline" onClick={onSuspend} className="self-start">
          Suspend account
        </Button>
      ) : null}
    </li>
  );
}

export function ActivityView({
  data,
  isExec,
  viewerUid,
}: {
  data: ActivityDTO;
  isExec: boolean;
  viewerUid: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<ActivityActor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmSuspend = useCallback(async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await execSuspend(target.uid, true);
      setTarget(null);
      router.refresh();
    } catch (err) {
      setError(adminActionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [target, busy, router]);

  const lookbackHours = Math.round(data.lookbackMs / 3_600_000);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">Account activity</h1>
        <button
          type="button"
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
          className="h-10 rounded-md border border-border px-4 text-sm font-medium text-foreground disabled:opacity-50"
        >
          {pending ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <p className="text-sm text-muted">
        Accounts that sent {data.notableThreshold} or more requests to one endpoint group inside a
        single rate-limit window in the last {lookbackHours} hours. A busy booth at lunch rush can
        appear here legitimately — the number to watch is <strong>blocked</strong>, which means the
        account kept pushing after it was rate-limited.
      </p>

      {data.truncated ? (
        <p role="status" className="text-sm font-medium text-warning">
          Showing the busiest windows only — more activity exists than this page scanned.
        </p>
      ) : null}

      {data.actors.length === 0 ? (
        <p className="text-sm text-muted">No account has come close to a rate limit.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.actors.map((actor) => (
            <ActorRow
              key={actor.uid}
              actor={actor}
              isExec={isExec}
              isSelf={actor.uid === viewerUid}
              onSuspend={() => {
                setError(null);
                setTarget(actor);
              }}
            />
          ))}
        </ul>
      )}

      {target ? (
        <ConfirmDialog
          title="Suspend account?"
          confirmLabel="Suspend"
          danger
          busy={busy}
          onCancel={() => setTarget(null)}
          onConfirm={confirmSuspend}
        >
          <p>
            {target.displayName} is blocked from being topped up or charged, selling, and all admin
            actions until unsuspended.
          </p>
          {error ? (
            <p role="alert" className="font-medium text-danger">
              {error}
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
