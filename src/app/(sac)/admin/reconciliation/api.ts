"use client";

import type { ReconciliationDTO } from "@/lib/shared/types";

export class ReconciliationApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ReconciliationApiError";
  }
}

async function errorCodeOf(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: { code?: string } }).error?.code ?? "INTERNAL";
  } catch {
    return "INTERNAL";
  }
}

const ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many requests — wait a moment and try again.",
  VALIDATION: "Pick a valid date.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
};

export function reconciliationErrorMessage(code: string): string {
  return ERROR_MESSAGE[code] ?? "Couldn't load the reconciliation report. Try again.";
}

export async function requestReconciliation(
  date: string,
  signal?: AbortSignal,
): Promise<ReconciliationDTO> {
  const res = await fetch(`/api/sac/reconciliation?date=${encodeURIComponent(date)}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new ReconciliationApiError(await errorCodeOf(res));
  return (await res.json()) as ReconciliationDTO;
}
