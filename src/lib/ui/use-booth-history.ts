"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoothHistoryEntry } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import {
  historyErrorMessage,
  requestBoothHistory,
  type BoothHistoryFetcher,
} from "@/lib/ui/booth-history-api";

export type HistoryScope = "all" | "mine";

type ErrorSource = "head" | "older";

export interface UseBoothHistory {
  entries: BoothHistoryEntry[];
  scope: HistoryScope;
  cursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingOlder: boolean;
  error: string | null;
  setScope: (next: HistoryScope) => void;
  refresh: () => void;
  loadOlder: () => void;
  retry: () => void;
}

function codeOf(err: unknown): string {
  return err instanceof ApiError ? err.code : "NETWORK";
}

export function useBoothHistory({
  boothId,
  onError,
  requestHistory = requestBoothHistory,
  showScopeToggle = true,
}: {
  boothId: string;
  onError?: (message: string) => void;
  requestHistory?: BoothHistoryFetcher;
  showScopeToggle?: boolean;
}): UseBoothHistory {
  const [entries, setEntries] = useState<BoothHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [scope, setScopeState] = useState<HistoryScope>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<{ source: ErrorSource; message: string } | null>(null);

  const scopeRef = useRef<HistoryScope>("all");
  const headSeq = useRef(0);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const fail = useCallback((source: ErrorSource, err: unknown) => {
    const message = historyErrorMessage(codeOf(err));
    setError({ source, message });
    onErrorRef.current?.(message);
  }, []);

  const runHead = useCallback(
    (target: HistoryScope) => {
      const id = headSeq.current + 1;
      headSeq.current = id;
      requestHistory(boothId, {
        ...(showScopeToggle ? { mine: target === "mine" } : {}),
      })
        .then((dto) => {
          if (headSeq.current !== id) return;
          setEntries(dto.entries);
          setCursor(dto.nextCursor);
          setLoading(false);
          setRefreshing(false);
        })
        .catch((err: unknown) => {
          if (headSeq.current !== id) return;
          setLoading(false);
          setRefreshing(false);
          fail("head", err);
        });
    },
    [boothId, fail, requestHistory, showScopeToggle],
  );

  useEffect(() => {
    runHead(scopeRef.current);
  }, [runHead]);

  const setScope = useCallback(
    (next: HistoryScope) => {
      const target = showScopeToggle ? next : "all";
      if (scopeRef.current === target) return;
      scopeRef.current = target;
      setScopeState(target);
      setEntries([]);
      setCursor(null);
      setError(null);
      setLoading(true);
      runHead(target);
    },
    [runHead, showScopeToggle],
  );

  const refresh = useCallback(() => {
    if (refreshing) return;
    setError(null);
    setRefreshing(true);
    runHead(scopeRef.current);
  }, [refreshing, runHead]);

  const loadOlder = useCallback(() => {
    if (loadingOlder || cursor === null) return;
    const headId = headSeq.current;
    setLoadingOlder(true);
    setError(null);
    requestHistory(boothId, {
      ...(showScopeToggle ? { mine: scopeRef.current === "mine" } : {}),
      cursor,
    })
      .then((dto) => {
        setLoadingOlder(false);
        if (headSeq.current !== headId) return;
        setEntries((prev) => {
          const seen = new Set(prev.map((entry) => entry.entryId));
          return [...prev, ...dto.entries.filter((entry) => !seen.has(entry.entryId))];
        });
        setCursor(dto.nextCursor);
      })
      .catch((err: unknown) => {
        setLoadingOlder(false);
        if (headSeq.current !== headId) return;
        fail("older", err);
      });
  }, [boothId, cursor, fail, loadingOlder, requestHistory, showScopeToggle]);

  const retry = useCallback(() => {
    if (error === null) return;
    if (error.source === "older") {
      loadOlder();
      return;
    }
    setError(null);
    if (entries.length === 0) setLoading(true);
    else setRefreshing(true);
    runHead(scopeRef.current);
  }, [entries.length, error, loadOlder, runHead]);

  return {
    entries,
    scope,
    cursor,
    loading,
    refreshing,
    loadingOlder,
    error: error?.message ?? null,
    setScope,
    refresh,
    loadOlder,
    retry,
  };
}
