"use client";

import type { StudentLedgerDTO, StudentSearchDTO } from "@/lib/shared/types";

export class StudentsApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StudentsApiError";
  }
}

async function errorCodeOf(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: { code?: string } }).error?.code ?? "INTERNAL";
  } catch {
    return "INTERNAL";
  }
}

export const SEARCH_ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many searches — wait a moment and try again.",
  VALIDATION: "Type a student number, name, or email.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
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
  const res = await fetch(`/api/sac/students?q=${encodeURIComponent(q)}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new StudentsApiError(await errorCodeOf(res));
  return (await res.json()) as StudentSearchDTO;
}

export async function requestStudentLedger(
  uid: string,
  cursor: string | null,
): Promise<StudentLedgerDTO> {
  const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(`/api/sac/students/${encodeURIComponent(uid)}/ledger${suffix}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new StudentsApiError(await errorCodeOf(res));
  return (await res.json()) as StudentLedgerDTO;
}
