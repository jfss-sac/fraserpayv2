"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedDTO, FeedEntry, LedgerType, RepeatBuyerAlert } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { type FeedQueryParams, feedErrorMessage, requestFeed } from "./api";

export const FEED_POLL_MS = 5 * 60_000;

export type FeedFilter =
  | { kind: "all" }
  | { kind: "type"; type: LedgerType }
  | { kind: "tag" }
  | { kind: "booth"; boothId: string; boothName: string }
  | { kind: "actor"; actorUid: string; actorName: string };

export const ALL_FILTER: FeedFilter = { kind: "all" };

export function filterToQuery(filter: FeedFilter): FeedQueryParams {
  switch (filter.kind) {
    case "all":
      return {};
    case "type":
      return { type: filter.type };
    case "tag":
      return { tag: "high-amount" };
    case "booth":
      return { boothId: filter.boothId };
    case "actor":
      return { actorUid: filter.actorUid };
  }
}

export function filtersEqual(a: FeedFilter, b: FeedFilter): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "type" && b.kind === "type") return a.type === b.type;
  if (a.kind === "booth" && b.kind === "booth") return a.boothId === b.boothId;
  if (a.kind === "actor" && b.kind === "actor") return a.actorUid === b.actorUid;
  return true;
}

const NO_ENTRIES: FeedEntry[] = [];

type FeedUpdate =
  | { kind: "prepend"; entries: FeedEntry[] }
  | { kind: "reset"; entries: FeedEntry[]; cursor: string | null };

export function feedEntryKey(entry: FeedEntry): string {
  return `${entry.kind}-${entry.id}`;
}

function newSince(existing: FeedEntry[], head: FeedEntry[]): FeedEntry[] {
  const keys = new Set(existing.map(feedEntryKey));
  return head.filter((e) => !keys.has(feedEntryKey(e)));
}

function headUpdate(existing: FeedEntry[], head: FeedDTO): FeedUpdate | null {
  const newest = existing.at(0);
  const newestKey = newest ? feedEntryKey(newest) : null;
  if (newestKey === null || !head.entries.some((e) => feedEntryKey(e) === newestKey)) {
    return head.entries.length > 0
      ? { kind: "reset", entries: head.entries, cursor: head.nextCursor }
      : null;
  }
  const fresh = newSince(existing, head.entries);
  return fresh.length > 0 ? { kind: "prepend", entries: fresh } : null;
}

function codeOf(err: unknown): string {
  return err instanceof ApiError ? err.code : "NETWORK";
}

export interface UseFeed {
  entries: FeedEntry[];
  repeatBuyers: RepeatBuyerAlert[];
  repeatBuyersTruncated: boolean;
  filter: FeedFilter;
  pending: FeedEntry[];
  pendingTruncated: boolean;
  cursor: string | null;
  loading: boolean;
  loadingOlder: boolean;
  refreshing: boolean;
  error: string | null;
  setFilter: (next: FeedFilter) => void;
  refresh: () => void;
  applyPending: () => void;
  loadOlder: () => void;
}

export function useFeed({
  initialEntries,
  initialCursor,
  initialRepeatBuyers = [],
  initialRepeatBuyersTruncated = false,
  pollMs = FEED_POLL_MS,
}: {
  initialEntries: FeedEntry[];
  initialCursor: string | null;
  initialRepeatBuyers?: RepeatBuyerAlert[];
  initialRepeatBuyersTruncated?: boolean;
  pollMs?: number;
}): UseFeed {
  const [entries, setEntries] = useState<FeedEntry[]>(initialEntries);
  const [repeatBuyers, setRepeatBuyers] = useState<RepeatBuyerAlert[]>(initialRepeatBuyers);
  const [repeatBuyersTruncated, setRepeatBuyersTruncated] = useState(initialRepeatBuyersTruncated);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [filter, setFilterState] = useState<FeedFilter>(ALL_FILTER);
  const [pendingUpdate, setPendingUpdate] = useState<FeedUpdate | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entriesRef = useRef(entries);
  const filterRef = useRef(filter);
  const pendingRef = useRef<FeedUpdate | null>(null);
  const filterSeq = useRef(0);
  const refreshSeq = useRef(0);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const stashPending = useCallback((next: FeedUpdate | null) => {
    pendingRef.current = next;
    setPendingUpdate(next);
  }, []);

  const applyUpdate = useCallback((update: FeedUpdate) => {
    if (update.kind === "reset") {
      setEntries(update.entries);
      setCursor(update.cursor);
      return;
    }
    setEntries((prev) => [...update.entries, ...prev]);
  }, []);

  const setFilter = useCallback(
    (next: FeedFilter) => {
      if (filtersEqual(filterRef.current, next)) return;
      const id = filterSeq.current + 1;
      filterSeq.current = id;
      filterRef.current = next;
      setFilterState(next);
      stashPending(null);
      setError(null);
      setLoading(true);
      requestFeed(filterToQuery(next))
        .then((dto) => {
          if (filterSeq.current !== id) return;
          setEntries(dto.entries);
          setCursor(dto.nextCursor);
          setRepeatBuyers(dto.repeatBuyers);
          setRepeatBuyersTruncated(dto.repeatBuyersTruncated);
          setLoading(false);
        })
        .catch((err) => {
          if (filterSeq.current !== id) return;
          setError(feedErrorMessage(codeOf(err)));
          setLoading(false);
        });
    },
    [stashPending],
  );

  const refresh = useCallback(() => {
    const id = refreshSeq.current + 1;
    refreshSeq.current = id;
    const target = filterRef.current;
    setError(null);
    setRefreshing(true);
    requestFeed(filterToQuery(target))
      .then((dto) => {
        if (refreshSeq.current !== id) return;
        setRefreshing(false);
        if (!filtersEqual(filterRef.current, target)) return;
        const update = headUpdate(entriesRef.current, dto);
        if (update) applyUpdate(update);
        setRepeatBuyers(dto.repeatBuyers);
        setRepeatBuyersTruncated(dto.repeatBuyersTruncated);
        stashPending(null);
      })
      .catch((err) => {
        if (refreshSeq.current !== id) return;
        setRefreshing(false);
        if (!filtersEqual(filterRef.current, target)) return;
        setError(feedErrorMessage(codeOf(err)));
      });
  }, [applyUpdate, stashPending]);

  const applyPending = useCallback(() => {
    const update = pendingRef.current;
    if (update === null) return;
    stashPending(null);
    applyUpdate(update);
  }, [applyUpdate, stashPending]);

  const loadOlder = useCallback(() => {
    if (loadingOlder || cursor === null) return;
    setLoadingOlder(true);
    setError(null);
    const target = filterRef.current;
    requestFeed({ ...filterToQuery(target), cursor })
      .then((dto) => {
        setLoadingOlder(false);
        if (!filtersEqual(filterRef.current, target)) return;
        setEntries((prev) => [...prev, ...newSince(prev, dto.entries)]);
        setCursor(dto.nextCursor);
      })
      .catch((err) => {
        setLoadingOlder(false);
        if (!filtersEqual(filterRef.current, target)) return;
        setError(feedErrorMessage(codeOf(err)));
      });
  }, [loadingOlder, cursor]);

  useEffect(() => {
    const timer = setInterval(() => {
      const target = filterRef.current;
      requestFeed(filterToQuery(target))
        .then((dto) => {
          if (!filtersEqual(filterRef.current, target)) return;
          const update = headUpdate(entriesRef.current, dto);
          setRepeatBuyers(dto.repeatBuyers);
          setRepeatBuyersTruncated(dto.repeatBuyersTruncated);
          if (update) stashPending(update);
        })
        .catch(() => {});
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, stashPending]);

  return {
    entries,
    repeatBuyers,
    repeatBuyersTruncated,
    filter,
    pending: pendingUpdate?.entries ?? NO_ENTRIES,
    pendingTruncated: pendingUpdate?.kind === "reset" && pendingUpdate.cursor !== null,
    cursor,
    loading,
    loadingOlder,
    refreshing,
    error,
    setFilter,
    refresh,
    applyPending,
    loadOlder,
  };
}
