"use client";

import { useCallback } from "react";
import { useToast } from "@/lib/ui/toast";
import { Button } from "@/lib/ui/vendor/button";
import { cn } from "@/lib/ui/vendor/utils";
import { BoothHistoryRow } from "./history-row";
import { type HistoryScope, useBoothHistory } from "./use-booth-history";

const SCOPES: readonly { scope: HistoryScope; label: string }[] = [
  { scope: "all", label: "All" },
  { scope: "mine", label: "Just mine" },
];

function HistorySkeleton() {
  return (
    <div role="status" aria-label="Loading sales" className="flex flex-col gap-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-16 animate-pulse rounded-md bg-surface" />
      ))}
    </div>
  );
}

export function BoothHistoryView({ boothId }: { boothId: string }) {
  const { push } = useToast();
  const onError = useCallback((message: string) => void push(message, "error"), [push]);
  const history = useBoothHistory({ boothId, onError });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">History</h1>
        <Button
          type="button"
          variant="outline"
          onClick={history.refresh}
          disabled={history.loading || history.refreshing}
        >
          {history.refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div role="group" aria-label="Filter sales" className="flex flex-wrap gap-1">
        {SCOPES.map((option) => {
          const active = option.scope === history.scope;
          return (
            <button
              key={option.scope}
              type="button"
              aria-pressed={active}
              onClick={() => history.setScope(option.scope)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium",
                active ? "bg-brand text-brand-foreground" : "bg-surface text-muted",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {history.error !== null ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger/5 p-3"
        >
          <p className="text-sm font-medium text-danger">{history.error}</p>
          <Button type="button" variant="outline" onClick={history.retry}>
            Try again
          </Button>
        </div>
      ) : null}

      {history.loading ? (
        <HistorySkeleton />
      ) : history.entries.length > 0 ? (
        <ul aria-label="Sales" className="flex flex-col divide-y divide-border">
          {history.entries.map((entry) => (
            <BoothHistoryRow key={entry.entryId} entry={entry} />
          ))}
        </ul>
      ) : history.error === null ? (
        <p className="text-sm text-muted">No sales yet.</p>
      ) : null}

      {!history.loading && history.cursor !== null ? (
        <Button
          type="button"
          variant="outline"
          onClick={history.loadOlder}
          disabled={history.loadingOlder}
        >
          {history.loadingOlder ? "Loading…" : "Load older"}
        </Button>
      ) : null}
    </section>
  );
}
