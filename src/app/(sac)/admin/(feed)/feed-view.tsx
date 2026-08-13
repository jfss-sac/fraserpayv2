"use client";

import { useEffect, useRef } from "react";
import type { FeedEntry, RepeatBuyerAlert } from "@/lib/shared/types";
import { Button } from "@/lib/ui/vendor/button";
import { cn } from "@/lib/ui/vendor/utils";
import { REPEAT_BUYER_WINDOW_MS } from "@/lib/shared/constants";
import { FeedRow, type RowActions } from "./feed-row";
import {
  ALL_FILTER,
  FEED_POLL_MS,
  type FeedFilter,
  feedEntryKey,
  filtersEqual,
  useFeed,
} from "./use-feed";

const POLL_MINUTES = FEED_POLL_MS / 60_000;

const CHIPS: { label: string; filter: FeedFilter }[] = [
  { label: "All", filter: { kind: "all" } },
  { label: "Top-ups", filter: { kind: "type", type: "topup" } },
  { label: "Purchases", filter: { kind: "type", type: "purchase" } },
  { label: "Refunds", filter: { kind: "type", type: "refund" } },
  { label: "Adjustments", filter: { kind: "type", type: "adjustment" } },
  { label: "High amount", filter: { kind: "tag" } },
];

function ActiveFilterPill({ filter, onClear }: { filter: FeedFilter; onClear: () => void }) {
  if (filter.kind !== "booth" && filter.kind !== "actor") return null;
  const label =
    filter.kind === "booth" ? `Booth · ${filter.boothName}` : `By · ${filter.actorName}`;
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand"
      aria-label={`Clear filter ${label}`}
    >
      <span>{label}</span>
      <span aria-hidden>✕</span>
    </button>
  );
}

function RepeatBuyerBanner({
  buyers,
  truncated,
}: {
  buyers: RepeatBuyerAlert[];
  truncated: boolean;
}) {
  if (buyers.length === 0 && !truncated) return null;
  const windowMinutes = REPEAT_BUYER_WINDOW_MS / 60_000;
  return (
    <section
      aria-label="Repeat charge alerts"
      className="flex flex-col gap-1 rounded-md border border-danger/40 bg-danger/5 p-3"
    >
      {buyers.length > 0 ? (
        <>
          <p className="text-sm font-semibold text-foreground">
            Charged unusually often in the last {windowMinutes} minutes
          </p>
          {buyers.map((buyer) => (
            <p key={buyer.studentUid} className="text-sm text-muted">
              {buyer.studentName} — {buyer.charges} charges
            </p>
          ))}
        </>
      ) : null}
      {truncated ? (
        <p role="status" className="text-sm font-medium text-warning">
          Too many sales in the last {windowMinutes} minutes to check them all — this alert covers
          only the most recent ones, so a repeat buyer may be missing. Check the feed itself.
        </p>
      ) : null}
    </section>
  );
}

export function FeedView({
  initialEntries,
  initialCursor,
  initialRepeatBuyers,
  initialRepeatBuyersTruncated,
  pollMs,
}: {
  initialEntries: FeedEntry[];
  initialCursor: string | null;
  initialRepeatBuyers?: RepeatBuyerAlert[];
  initialRepeatBuyersTruncated?: boolean;
  pollMs?: number;
}) {
  const feed = useFeed({
    initialEntries,
    initialCursor,
    initialRepeatBuyers,
    initialRepeatBuyersTruncated,
    pollMs,
  });
  const actions: RowActions = {
    onFilterBooth: (boothId, boothName) => feed.setFilter({ kind: "booth", boothId, boothName }),
    onFilterActor: (actorUid, actorName) => feed.setFilter({ kind: "actor", actorUid, actorName }),
  };

  const sentinel = useRef<HTMLDivElement>(null);
  const loadOlderRef = useRef(feed.loadOlder);

  useEffect(() => {
    loadOlderRef.current = feed.loadOlder;
  }, [feed.loadOlder]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((items) => {
      if (items.some((i) => i.isIntersecting)) loadOlderRef.current();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [feed.cursor]);

  const activeChip = CHIPS.find((c) => filtersEqual(feed.filter, c.filter));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-foreground">Feed</h1>
        <div className="flex flex-col items-end gap-0.5">
          <Button type="button" variant="outline" onClick={feed.refresh} disabled={feed.refreshing}>
            {feed.refreshing ? "Refreshing…" : "Refresh"}
          </Button>
          <span className="text-xs text-muted">Auto-refreshes every {POLL_MINUTES} min</span>
        </div>
      </div>

      <div role="group" aria-label="Filter feed" className="flex flex-wrap gap-1">
        {CHIPS.map((chip) => {
          const active = chip === activeChip;
          return (
            <button
              key={chip.label}
              type="button"
              aria-pressed={active}
              onClick={() => feed.setFilter(chip.filter)}
              className={cn(
                "rounded-full px-3 py-1 text-sm font-medium",
                active
                  ? "bg-brand text-brand-foreground"
                  : "bg-surface text-muted hover:text-foreground",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <RepeatBuyerBanner buyers={feed.repeatBuyers} truncated={feed.repeatBuyersTruncated} />

      <ActiveFilterPill filter={feed.filter} onClear={() => feed.setFilter(ALL_FILTER)} />

      {feed.error ? (
        <p role="status" className="text-sm font-medium text-danger">
          {feed.error}
        </p>
      ) : null}

      {feed.pending.length > 0 ? (
        <Button type="button" onClick={feed.applyPending}>
          {feed.pending.length === 1
            ? "1 new transaction — show"
            : `${feed.pending.length}${feed.pendingTruncated ? "+" : ""} new transactions — show`}
        </Button>
      ) : null}

      {feed.loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : feed.entries.length === 0 ? (
        <p className="text-sm text-muted">No transactions yet.</p>
      ) : (
        <ul aria-label="Transactions" className="-ml-3 flex flex-col divide-y divide-border">
          {feed.entries.map((entry) => (
            <FeedRow key={feedEntryKey(entry)} entry={entry} actions={actions} />
          ))}
        </ul>
      )}

      {feed.cursor !== null ? (
        <>
          <div ref={sentinel} aria-hidden className="h-px" />
          <Button
            type="button"
            variant="outline"
            onClick={feed.loadOlder}
            disabled={feed.loadingOlder}
          >
            {feed.loadingOlder ? "Loading…" : "Load older"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
