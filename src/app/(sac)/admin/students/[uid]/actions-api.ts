"use client";

import type { AdjustResult, RefundResult, SacRoles } from "@/lib/shared/types";
import { ApiError, NETWORK_ERROR_MESSAGE, postJson } from "@/lib/ui/api-client";

export function adjustErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
  switch (err.code) {
    case "INSUFFICIENT_FUNDS":
      return "That would drop the balance below zero.";
    case "FORBIDDEN":
      return err.serverMessage || "You aren't allowed to make that adjustment.";
    case "VALIDATION":
      return err.serverMessage || "Check the amount and reason and try again.";
    case "CONFLICT":
      return err.serverMessage || "That adjustment conflicts with the current state.";
    case "NOT_FOUND":
      return "Student not found.";
    case "IDEMPOTENCY_CONFLICT":
      return "That adjustment is still going through — check the ledger before retrying.";
    case "RATE_LIMITED":
      return "Too many actions — wait a moment and try again.";
    default:
      return "Adjustment failed. Try again.";
  }
}

export function refundErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
  switch (err.code) {
    case "CONFLICT":
      return err.serverMessage || "That refund conflicts with the current state.";
    case "FORBIDDEN":
      return err.serverMessage || "You aren't allowed to make that refund.";
    case "VALIDATION":
      return err.serverMessage || "Check the items and reason and try again.";
    case "NOT_FOUND":
      return "The original purchase could not be found.";
    case "RATE_LIMITED":
      return "Too many actions — wait a moment and try again.";
    default:
      return "Refund failed. Try again.";
  }
}

export function adminActionErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return NETWORK_ERROR_MESSAGE;
  switch (err.code) {
    case "CONFLICT":
      return err.serverMessage || "That action conflicts with the current state.";
    case "NOT_FOUND":
      return "User not found.";
    case "RATE_LIMITED":
      return "Too many actions — wait a moment and try again.";
    default:
      return "That action failed. Try again.";
  }
}

export function execAdjust(
  input: {
    studentUid: string;
    amountCents: number;
    reason: string;
    originalEntryId?: string;
  },
  idempotencyKey: string,
): Promise<AdjustResult> {
  return postJson<AdjustResult>("/api/exec/adjust", input, idempotencyKey);
}

export function execRefund(
  input: {
    originalEntryId: string;
    reason: string;
    lineItems?: { itemId: string; qty: number }[];
  },
  idempotencyKey: string,
): Promise<RefundResult> {
  return postJson<RefundResult>("/api/exec/refund", input, idempotencyKey);
}

export function execRegenPaymentCode(studentUid: string): Promise<{ studentUid: string }> {
  return postJson("/api/exec/payment-code", { studentUid });
}

export function execSuspend(
  studentUid: string,
  suspended: boolean,
): Promise<{ studentUid: string; suspended: boolean }> {
  return postJson("/api/exec/suspend", { studentUid, suspended });
}

export function execRoles(
  targetUid: string,
  role: keyof SacRoles,
  grant: boolean,
): Promise<{ targetUid: string; role: keyof SacRoles; grant: boolean; roles: SacRoles }> {
  return postJson("/api/exec/roles", { targetUid, role, grant });
}
