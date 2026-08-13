"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { UUID_V4_RE } from "@/lib/shared/uuid";
import type { BuyerId } from "@/lib/ui/scanner";

export const PENDING_RETRY_WINDOW_MS = 15 * 60 * 1000;
export const PENDING_SHOW_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface PendingRecordBase {
  key: string;
  sessionId: string;
  startedAt: number;
}

export function isPendingRecordBase(value: unknown): value is PendingRecordBase {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.key === "string" &&
    UUID_V4_RE.test(record.key) &&
    typeof record.sessionId === "string" &&
    typeof record.startedAt === "number"
  );
}

export function isBuyerId(value: unknown): value is BuyerId {
  if (value === null || typeof value !== "object") return false;
  const buyer = value as Record<string, unknown>;
  return typeof buyer.paymentCode === "string" || typeof buyer.studentNumber === "string";
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribePendingMoney(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

function recordStorageKey(scopeKey: string, key: string): string {
  return `${scopeKey}:${key}`;
}

// Requiring a UUID v4 suffix keeps a scope whose id embeds a colon from
// matching a shorter scope's prefix and adopting its records.
function scopedStorageKeys(scopeKey: string): string[] {
  const store = storage();
  if (store === null) return [];
  const prefix = `${scopeKey}:`;
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i);
      if (name === null || !name.startsWith(prefix)) continue;
      if (!UUID_V4_RE.test(name.slice(prefix.length))) continue;
      keys.push(name);
    }
    keys.sort();
  } catch {
    return [];
  }
  return keys;
}

export interface PendingStore<T extends PendingRecordBase> {
  readRaw(scopeKey: string): string;
  write(scopeKey: string, record: T): void;
  clear(scopeKey: string, key: string): void;
  prune(scopeKey: string, now?: number): void;
  parseOne(raw: string | null, now?: number): T | null;
  parseMany(raw: string, now?: number): T[];
  useRecords(scopeKey: string): T[];
}

export function createPendingStore<T extends PendingRecordBase>(
  isRecord: (value: unknown) => value is T,
): PendingStore<T> {
  function parseRecord(raw: string | null): T | null {
    if (raw === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    return isRecord(value) ? value : null;
  }

  function parseOne(raw: string | null, now = Date.now()): T | null {
    const record = parseRecord(raw);
    if (record === null) return null;
    return now - record.startedAt > PENDING_SHOW_WINDOW_MS ? null : record;
  }

  function parseMany(raw: string, now = Date.now()): T[] {
    const seen = new Set<string>();
    const records: T[] = [];
    for (const line of raw.split("\n")) {
      const record = parseOne(line, now);
      if (record === null || seen.has(record.key)) continue;
      seen.add(record.key);
      records.push(record);
    }
    return records.sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
  }

  function readRaw(scopeKey: string): string {
    const store = storage();
    if (store === null) return "";
    const values: string[] = [];
    try {
      for (const name of scopedStorageKeys(scopeKey)) {
        const value = store.getItem(name);
        if (value !== null) values.push(value);
      }
    } catch {
      return "";
    }
    return values.join("\n");
  }

  function write(scopeKey: string, record: T): void {
    try {
      storage()?.setItem(recordStorageKey(scopeKey, record.key), JSON.stringify(record));
    } catch {
      // storage unavailable: the request still goes out, only crash recovery is lost
    }
    notify();
  }

  function clear(scopeKey: string, key: string): void {
    try {
      storage()?.removeItem(recordStorageKey(scopeKey, key));
    } catch {
      // storage unavailable: nothing was persisted to clear
    }
    notify();
  }

  function prune(scopeKey: string, now = Date.now()): void {
    const store = storage();
    if (store === null) return;
    let removed = false;
    try {
      for (const name of scopedStorageKeys(scopeKey)) {
        const record = parseRecord(store.getItem(name));
        const orphaned =
          record === null ||
          now - record.startedAt > PENDING_SHOW_WINDOW_MS ||
          name !== recordStorageKey(scopeKey, record.key);
        if (!orphaned) continue;
        store.removeItem(name);
        removed = true;
      }
    } catch {
      return;
    }
    if (removed) notify();
  }

  function useRecords(scopeKey: string): T[] {
    const getSnapshot = useCallback(() => readRaw(scopeKey), [scopeKey]);
    const raw = useSyncExternalStore(subscribePendingMoney, getSnapshot, () => "");
    const pending = useMemo(() => parseMany(raw), [raw]);

    useEffect(() => {
      prune(scopeKey);
    }, [raw, scopeKey]);

    useEffect(() => {
      const oldest = pending[0];
      if (oldest === undefined) return;
      const expiresInMs = oldest.startedAt + PENDING_SHOW_WINDOW_MS - Date.now();
      const timer = setTimeout(() => prune(scopeKey), expiresInMs + 1);
      return () => clearTimeout(timer);
    }, [pending, scopeKey]);

    return pending;
  }

  return { readRaw, write, clear, prune, parseOne, parseMany, useRecords };
}
