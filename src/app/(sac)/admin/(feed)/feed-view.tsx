"use client";

import { useEffect, useRef, useState } from "react";
import type { FeedEntry, RepeatBuyerAlert } from "@/lib/shared/types";
import { Button } from "@/lib/ui/vendor/button";
import { cn } from "@/lib/ui/vendor/utils";
import { REPEAT_BUYER_WINDOW_MS } from "@/lib/shared/constants";
import { FeedRow, type RowActions } from "./feed-row";
import {
  customFeedTimeRange,
  feedTimeRangeForPreset,
  type FeedTimePreset,
  type FeedTimeRange,
} from "./feed-time-range";
import {
  ALL_FILTER,
  FEED_POLL_MS,
  type FeedFilter,
  feedEntryKey,
  filtersEqual,
  useFeed,
} from "./use-feed";

const POLL_MINUTES = FEED_POLL_MS / 60_000;

const TIME_PRESETS: { label: string; preset: FeedTimePreset }[] = [
  { label: "Last 15 min", preset: "15m" },
  { label: "Last 30 min", preset: "30m" },
  { label: "Last 60 min", preset: "60m" },
  { label: "Today", preset: "today" },
];

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

function ActiveTimeRangePill({ range, onClear }: { range: FeedTimeRange; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-2 rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand"
      aria-label={`Clear time range ${range.label}`}
    >
      <span>Time · {range.label}</span>
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
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
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

  function applyCustomRange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = customFeedTimeRange(customFrom, customTo);
    if (!next) {
      setCustomError("Choose a start and end with the end after the start.");
      return;
    }
    setCustomError(null);
    feed.setRange(next);
  }

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

      <div className="flex flex-col gap-2">
        <div role="group" aria-label="Feed time range" className="flex flex-wrap gap-1">
          {TIME_PRESETS.map(({ label, preset }) => {
            const active = feed.range?.label === label;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCustomError(null);
                  feed.setRange(feedTimeRangeForPreset(preset));
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-sm font-medium",
                  active
                    ? "bg-brand text-brand-foreground"
                    : "bg-surface text-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        <form onSubmit={applyCustomRange} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1 text-sm text-muted">
            From
            <input
              aria-label="From"
              type="datetime-local"
              value={customFrom}
              onChange={(event) => {
                setCustomFrom(event.target.value);
                setCustomError(null);
              }}
              className="h-10 rounded-md border border-border bg-background px-3 text-base text-foreground"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            To
            <input
              aria-label="To"
              type="datetime-local"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => {
                setCustomTo(event.target.value);
                setCustomError(null);
              }}
              className="h-10 rounded-md border border-border bg-background px-3 text-base text-foreground"
            />
          </label>
          <Button type="submit" variant="outline" disabled={!customFrom || !customTo}>
            Apply custom range
          </Button>
        </form>
        {customError ? (
          <p role="status" className="text-sm font-medium text-danger">
            {customError}
          </p>
        ) : null}
      </div>

      <RepeatBuyerBanner buyers={feed.repeatBuyers} truncated={feed.repeatBuyersTruncated} />

      <div className="flex flex-wrap gap-2">
        <ActiveFilterPill filter={feed.filter} onClear={() => feed.setFilter(ALL_FILTER)} />
        {feed.range ? (
          <ActiveTimeRangePill range={feed.range} onClear={() => feed.setRange(null)} />
        ) : null}
      </div>

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
