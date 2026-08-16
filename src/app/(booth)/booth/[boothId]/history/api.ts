"use client";

import type { BoothHistoryDTO } from "@/lib/shared/types";
import { NETWORK_ERROR_MESSAGE, getJson } from "@/lib/ui/api-client";

const HISTORY_ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many refreshes — wait a moment and try again.",
  FORBIDDEN: "You're no longer a member of this booth.",
  NETWORK: NETWORK_ERROR_MESSAGE,
};

export function historyErrorMessage(code: string): string {
  return HISTORY_ERROR_MESSAGE[code] ?? "Couldn't load sales. Try again.";
}

export interface BoothHistoryParams {
  mine?: boolean;
  cursor?: string;
}

export function buildHistoryQuery({ mine, cursor }: BoothHistoryParams): string {
  const search = new URLSearchParams();
  if (mine) search.set("mine", "1");
  if (cursor) search.set("cursor", cursor);
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function requestBoothHistory(
  boothId: string,
  params: BoothHistoryParams,
): Promise<BoothHistoryDTO> {
  return getJson<BoothHistoryDTO>(
    `/api/booth/${encodeURIComponent(boothId)}/history${buildHistoryQuery(params)}`,
  );
}
