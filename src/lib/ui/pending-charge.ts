"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { UUID_V4_RE } from "@/lib/shared/uuid";
import type { BuyerId } from "@/lib/ui/scanner";

export const PENDING_CHARGE_RETRY_WINDOW_MS = 15 * 60 * 1000;
export const PENDING_CHARGE_SHOW_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface PendingChargeItem {
  itemId: string;
  qty: number;
}

export interface PendingCharge {
  key: string;
  sessionId: string;
  buyer: BuyerId;
  buyerName: string;
  items: PendingChargeItem[];
  amountCents: number;
  startedAt: number;
}

export interface PendingChargeScope {
  actorUid: string;
  boothId: string;
}

function scopeKey({ actorUid, boothId }: PendingChargeScope): string {
  return `fraserpay:pending-charge:${actorUid}:${boothId}`;
}

function storagePrefix(scope: PendingChargeScope): string {
  return `${scopeKey(scope)}:`;
}

function recordStorageKey(scope: PendingChargeScope, key: string): string {
  return `${storagePrefix(scope)}${key}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Requiring a UUID v4 suffix keeps a booth whose id embeds a colon from
// matching a shorter booth's prefix and adopting its records.
function scopedStorageKeys(scope: PendingChargeScope): string[] {
  const store = storage();
  if (store === null) return [];
  const prefix = storagePrefix(scope);
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

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribePendingCharge(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

export function readPendingChargesRaw(scope: PendingChargeScope): string {
  const store = storage();
  if (store === null) return "";
  const values: string[] = [];
  try {
    for (const name of scopedStorageKeys(scope)) {
      const value = store.getItem(name);
      if (value !== null) values.push(value);
    }
  } catch {
    return "";
  }
  return values.join("\n");
}

export function writePendingCharge(scope: PendingChargeScope, pending: PendingCharge): void {
  try {
    storage()?.setItem(recordStorageKey(scope, pending.key), JSON.stringify(pending));
  } catch {
    // storage unavailable: the charge still goes out, only crash recovery is lost
  }
  notify();
}

export function clearPendingCharge(scope: PendingChargeScope, key: string): void {
  try {
    storage()?.removeItem(recordStorageKey(scope, key));
  } catch {
    // storage unavailable: nothing was persisted to clear
  }
  notify();
}

export function prunePendingCharges(scope: PendingChargeScope, now = Date.now()): void {
  const store = storage();
  if (store === null) return;
  let removed = false;
  try {
    for (const name of scopedStorageKeys(scope)) {
      const record = parseRecord(store.getItem(name));
      const orphaned =
        record === null ||
        now - record.startedAt > PENDING_CHARGE_SHOW_WINDOW_MS ||
        name !== recordStorageKey(scope, record.key);
      if (!orphaned) continue;
      store.removeItem(name);
      removed = true;
    }
  } catch {
    return;
  }
  if (removed) notify();
}

function isBuyerId(value: unknown): value is BuyerId {
  if (value === null || typeof value !== "object") return false;
  const buyer = value as Record<string, unknown>;
  return typeof buyer.paymentCode === "string" || typeof buyer.studentNumber === "string";
}

function isPendingChargeItem(value: unknown): value is PendingChargeItem {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.itemId === "string" && Number.isInteger(item.qty) && (item.qty as number) > 0;
}

function isPendingCharge(value: unknown): value is PendingCharge {
  if (value === null || typeof value !== "object") return false;
  const pending = value as Record<string, unknown>;
  return (
    typeof pending.key === "string" &&
    UUID_V4_RE.test(pending.key) &&
    typeof pending.sessionId === "string" &&
    typeof pending.buyerName === "string" &&
    typeof pending.amountCents === "number" &&
    typeof pending.startedAt === "number" &&
    isBuyerId(pending.buyer) &&
    Array.isArray(pending.items) &&
    pending.items.length > 0 &&
    pending.items.every(isPendingChargeItem)
  );
}

function parseRecord(raw: string | null): PendingCharge | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return isPendingCharge(value) ? value : null;
}

export function parsePendingCharge(raw: string | null, now = Date.now()): PendingCharge | null {
  const record = parseRecord(raw);
  if (record === null) return null;
  return now - record.startedAt > PENDING_CHARGE_SHOW_WINDOW_MS ? null : record;
}

export function parsePendingCharges(raw: string, now = Date.now()): PendingCharge[] {
  const seen = new Set<string>();
  const records: PendingCharge[] = [];
  for (const line of raw.split("\n")) {
    const record = parsePendingCharge(line, now);
    if (record === null || seen.has(record.key)) continue;
    seen.add(record.key);
    records.push(record);
  }
  return records.sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
}

export function usePendingCharges(scope: PendingChargeScope): PendingCharge[] {
  const { actorUid, boothId } = scope;
  const getSnapshot = useCallback(
    () => readPendingChargesRaw({ actorUid, boothId }),
    [actorUid, boothId],
  );
  const raw = useSyncExternalStore(subscribePendingCharge, getSnapshot, () => "");
  const pending = useMemo(() => parsePendingCharges(raw), [raw]);

  useEffect(() => {
    prunePendingCharges({ actorUid, boothId });
  }, [raw, actorUid, boothId]);

  useEffect(() => {
    const oldest = pending[0];
    if (oldest === undefined) return;
    const expiresInMs = oldest.startedAt + PENDING_CHARGE_SHOW_WINDOW_MS - Date.now();
    const timer = setTimeout(() => prunePendingCharges({ actorUid, boothId }), expiresInMs + 1);
    return () => clearTimeout(timer);
  }, [pending, actorUid, boothId]);

  return pending;
}
