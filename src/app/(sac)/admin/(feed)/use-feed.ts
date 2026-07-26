"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedEntry, LedgerType } from "@/lib/shared/types";
import { type FeedQueryParams, FeedApiError, feedErrorMessage, requestFeed } from "./api";

export const FEED_POLL_MS = 60_000;

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

function newSince(existing: FeedEntry[], head: FeedEntry[]): FeedEntry[] {
  const ids = new Set(existing.map((e) => e.id));
  return head.filter((e) => !ids.has(e.id));
}

function codeOf(err: unknown): string {
  return err instanceof FeedApiError ? err.code : "NETWORK";
}

export interface UseFeed {
  entries: FeedEntry[];
  filter: FeedFilter;
  pending: FeedEntry[];
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
  pollMs = FEED_POLL_MS,
}: {
  initialEntries: FeedEntry[];
  initialCursor: string | null;
  pollMs?: number;
}): UseFeed {
  const [entries, setEntries] = useState<FeedEntry[]>(initialEntries);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [filter, setFilterState] = useState<FeedFilter>(ALL_FILTER);
  const [pending, setPending] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entriesRef = useRef(entries);
  const filterRef = useRef(filter);
  const headSeq = useRef(0);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const setFilter = useCallback((next: FeedFilter) => {
    if (filtersEqual(filterRef.current, next)) return;
    const id = headSeq.current + 1;
    headSeq.current = id;
    filterRef.current = next;
    setFilterState(next);
    setPending([]);
    setError(null);
    setLoading(true);
    requestFeed(filterToQuery(next))
      .then((dto) => {
        if (headSeq.current !== id) return;
        setEntries(dto.entries);
        setCursor(dto.nextCursor);
        setLoading(false);
      })
      .catch((err) => {
        if (headSeq.current !== id) return;
        setError(feedErrorMessage(codeOf(err)));
        setLoading(false);
      });
  }, []);

  const refresh = useCallback(() => {
    const id = headSeq.current + 1;
    headSeq.current = id;
    const target = filterRef.current;
    setError(null);
    setRefreshing(true);
    requestFeed(filterToQuery(target))
      .then((dto) => {
        if (headSeq.current !== id || !filtersEqual(filterRef.current, target)) return;
        const fresh = newSince(entriesRef.current, dto.entries);
        if (fresh.length > 0) setEntries((prev) => [...fresh, ...prev]);
        setPending([]);
        setRefreshing(false);
      })
      .catch((err) => {
        if (headSeq.current !== id) return;
        setError(feedErrorMessage(codeOf(err)));
        setRefreshing(false);
      });
  }, []);

  const applyPending = useCallback(() => {
    setPending((current) => {
      if (current.length > 0) setEntries((prev) => [...current, ...prev]);
      return [];
    });
  }, []);

  const loadOlder = useCallback(() => {
    if (loadingOlder || cursor === null) return;
    setLoadingOlder(true);
    setError(null);
    const target = filterRef.current;
    requestFeed({ ...filterToQuery(target), cursor })
      .then((dto) => {
        if (!filtersEqual(filterRef.current, target)) return;
        setEntries((prev) => [...prev, ...newSince(prev, dto.entries)]);
        setCursor(dto.nextCursor);
        setLoadingOlder(false);
      })
      .catch((err) => {
        setError(feedErrorMessage(codeOf(err)));
        setLoadingOlder(false);
      });
  }, [loadingOlder, cursor]);

  useEffect(() => {
    const timer = setInterval(() => {
      const target = filterRef.current;
      requestFeed(filterToQuery(target))
        .then((dto) => {
          if (!filtersEqual(filterRef.current, target)) return;
          const fresh = newSince(entriesRef.current, dto.entries);
          if (fresh.length > 0) setPending(fresh);
        })
        .catch(() => {});
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs]);

  return {
    entries,
    filter,
    pending,
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
