"use client";

import {
  type PendingRecordBase,
  PENDING_RETRY_WINDOW_MS,
  PENDING_SHOW_WINDOW_MS,
  createPendingStore,
  isBuyerId,
  isPendingRecordBase,
  subscribePendingMoney,
} from "@/lib/ui/pending-money";
import type { BuyerId } from "@/lib/ui/scanner";

export const PENDING_CHARGE_RETRY_WINDOW_MS = PENDING_RETRY_WINDOW_MS;
export const PENDING_CHARGE_SHOW_WINDOW_MS = PENDING_SHOW_WINDOW_MS;

export const subscribePendingCharge = subscribePendingMoney;

export interface PendingChargeItem {
  itemId: string;
  qty: number;
}

export interface PendingCharge extends PendingRecordBase {
  buyer: BuyerId;
  buyerName: string;
  items: PendingChargeItem[];
  amountCents: number;
}

export interface PendingChargeScope {
  actorUid: string;
  boothId: string;
}

function scopeKey({ actorUid, boothId }: PendingChargeScope): string {
  return `fraserpay:pending-charge:${actorUid}:${boothId}`;
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
    isPendingRecordBase(value) &&
    typeof pending.buyerName === "string" &&
    typeof pending.amountCents === "number" &&
    isBuyerId(pending.buyer) &&
    Array.isArray(pending.items) &&
    pending.items.length > 0 &&
    pending.items.every(isPendingChargeItem)
  );
}

const store = createPendingStore(isPendingCharge);

export function readPendingChargesRaw(scope: PendingChargeScope): string {
  return store.readRaw(scopeKey(scope));
}

export function writePendingCharge(scope: PendingChargeScope, pending: PendingCharge): void {
  store.write(scopeKey(scope), pending);
}

export function clearPendingCharge(scope: PendingChargeScope, key: string): void {
  store.clear(scopeKey(scope), key);
}

export function prunePendingCharges(scope: PendingChargeScope, now = Date.now()): void {
  store.prune(scopeKey(scope), now);
}

export function parsePendingCharge(raw: string | null, now = Date.now()): PendingCharge | null {
  return store.parseOne(raw, now);
}

export function parsePendingCharges(raw: string, now = Date.now()): PendingCharge[] {
  return store.parseMany(raw, now);
}

export function usePendingCharges(scope: PendingChargeScope): PendingCharge[] {
  return store.useRecords(scopeKey(scope));
}
