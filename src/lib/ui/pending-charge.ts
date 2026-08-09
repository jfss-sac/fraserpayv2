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

function storageKey({ actorUid, boothId }: PendingChargeScope): string {
  return `fraserpay:pending-charge:${actorUid}:${boothId}`;
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

export function subscribePendingCharge(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", listener);
  };
}

export function readPendingChargeRaw(scope: PendingChargeScope): string | null {
  try {
    return storage()?.getItem(storageKey(scope)) ?? null;
  } catch {
    return null;
  }
}

export function writePendingCharge(scope: PendingChargeScope, pending: PendingCharge): void {
  try {
    storage()?.setItem(storageKey(scope), JSON.stringify(pending));
  } catch {
    // storage unavailable: the charge still goes out, only crash recovery is lost
  }
  notify();
}

export function clearPendingCharge(scope: PendingChargeScope): void {
  try {
    storage()?.removeItem(storageKey(scope));
  } catch {
    // storage unavailable: nothing was persisted to clear
  }
  notify();
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

export function parsePendingCharge(raw: string | null, now = Date.now()): PendingCharge | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPendingCharge(value)) return null;
  return now - value.startedAt > PENDING_CHARGE_SHOW_WINDOW_MS ? null : value;
}

export function usePendingCharge(scope: PendingChargeScope): PendingCharge | null {
  const { actorUid, boothId } = scope;
  const getSnapshot = useCallback(
    () => readPendingChargeRaw({ actorUid, boothId }),
    [actorUid, boothId],
  );
  const raw = useSyncExternalStore(subscribePendingCharge, getSnapshot, () => null);
  const pending = useMemo(() => parsePendingCharge(raw), [raw]);

  useEffect(() => {
    if (raw !== null && pending === null) clearPendingCharge({ actorUid, boothId });
  }, [raw, pending, actorUid, boothId]);

  useEffect(() => {
    if (pending === null) return;
    const expiresInMs = pending.startedAt + PENDING_CHARGE_SHOW_WINDOW_MS - Date.now();
    const timer = setTimeout(() => clearPendingCharge({ actorUid, boothId }), expiresInMs + 1);
    return () => clearTimeout(timer);
  }, [pending, actorUid, boothId]);

  return pending;
}
