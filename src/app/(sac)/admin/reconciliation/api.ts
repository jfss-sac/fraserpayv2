"use client";

import type { ReconciliationDTO } from "@/lib/shared/types";
import { NETWORK_ERROR_MESSAGE, getJson } from "@/lib/ui/api-client";

const ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many requests — wait a moment and try again.",
  VALIDATION: "Pick a valid date.",
  NETWORK: NETWORK_ERROR_MESSAGE,
};

export function reconciliationErrorMessage(code: string): string {
  return ERROR_MESSAGE[code] ?? "Couldn't load the reconciliation report. Try again.";
}

export async function requestReconciliation(
  date: string,
  signal?: AbortSignal,
): Promise<ReconciliationDTO> {
  return getJson<ReconciliationDTO>(
    `/api/sac/reconciliation?date=${encodeURIComponent(date)}`,
    signal,
  );
}
