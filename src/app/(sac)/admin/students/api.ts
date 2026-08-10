"use client";

import type { StudentLedgerDTO, StudentSearchDTO } from "@/lib/shared/types";
import { NETWORK_ERROR_MESSAGE, getJson } from "@/lib/ui/api-client";

export const SEARCH_ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many searches — wait a moment and try again.",
  VALIDATION: "Type a student number, name, or email.",
  NETWORK: NETWORK_ERROR_MESSAGE,
};

export const LEDGER_ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many requests — wait a moment and try again.",
  NETWORK: "Couldn't load more history. Try again.",
};

export function searchErrorMessage(code: string): string {
  return SEARCH_ERROR_MESSAGE[code] ?? "Couldn't run that search. Try again.";
}

export function ledgerErrorMessage(code: string): string {
  return LEDGER_ERROR_MESSAGE[code] ?? "Couldn't load more history. Try again.";
}

export async function requestStudentSearch(
  q: string,
  signal?: AbortSignal,
): Promise<StudentSearchDTO> {
  return getJson<StudentSearchDTO>(`/api/sac/students?q=${encodeURIComponent(q)}`, signal);
}

export async function requestStudentLedger(
  uid: string,
  cursor: string | null,
): Promise<StudentLedgerDTO> {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return getJson<StudentLedgerDTO>(`/api/sac/students/${encodeURIComponent(uid)}/ledger${suffix}`);
}
