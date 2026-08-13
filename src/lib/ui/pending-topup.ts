"use client";

import type { PaymentMethod } from "@/lib/shared/types";
import {
  type PendingRecordBase,
  PENDING_RETRY_WINDOW_MS,
  PENDING_SHOW_WINDOW_MS,
  createPendingStore,
  isBuyerId,
  isPendingRecordBase,
} from "@/lib/ui/pending-money";
import type { BuyerId } from "@/lib/ui/scanner";

export const PENDING_TOPUP_RETRY_WINDOW_MS = PENDING_RETRY_WINDOW_MS;
export const PENDING_TOPUP_SHOW_WINDOW_MS = PENDING_SHOW_WINDOW_MS;

export interface PendingTopUp extends PendingRecordBase {
  buyer: BuyerId;
  studentName: string;
  amountCents: number;
  method: PaymentMethod;
  overrideReason?: string;
}

function scopeKey(actorUid: string): string {
  return `fraserpay:pending-topup:${actorUid}`;
}

function isPendingTopUp(value: unknown): value is PendingTopUp {
  if (value === null || typeof value !== "object") return false;
  const pending = value as Record<string, unknown>;
  return (
    isPendingRecordBase(value) &&
    typeof pending.studentName === "string" &&
    Number.isInteger(pending.amountCents) &&
    (pending.amountCents as number) > 0 &&
    (pending.method === "cash" || pending.method === "card") &&
    (pending.overrideReason === undefined || typeof pending.overrideReason === "string") &&
    isBuyerId(pending.buyer)
  );
}

const store = createPendingStore(isPendingTopUp);

export function readPendingTopUpsRaw(actorUid: string): string {
  return store.readRaw(scopeKey(actorUid));
}

export function writePendingTopUp(actorUid: string, pending: PendingTopUp): void {
  store.write(scopeKey(actorUid), pending);
}

export function clearPendingTopUp(actorUid: string, key: string): void {
  store.clear(scopeKey(actorUid), key);
}

export function prunePendingTopUps(actorUid: string, now = Date.now()): void {
  store.prune(scopeKey(actorUid), now);
}

export function parsePendingTopUp(raw: string | null, now = Date.now()): PendingTopUp | null {
  return store.parseOne(raw, now);
}

export function parsePendingTopUps(raw: string, now = Date.now()): PendingTopUp[] {
  return store.parseMany(raw, now);
}

export function usePendingTopUps(actorUid: string): PendingTopUp[] {
  return store.useRecords(scopeKey(actorUid));
}
