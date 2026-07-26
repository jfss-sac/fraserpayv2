"use client";

import type { FeedDTO } from "@/lib/shared/types";

export class FeedApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FeedApiError";
  }
}

async function errorCodeOf(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: { code?: string } }).error?.code ?? "INTERNAL";
  } catch {
    return "INTERNAL";
  }
}

export const FEED_ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many refreshes — wait a moment and try again.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
};

export function feedErrorMessage(code: string): string {
  return FEED_ERROR_MESSAGE[code] ?? "Couldn't load the feed. Try again.";
}

export interface FeedQueryParams {
  type?: string;
  boothId?: string;
  actorUid?: string;
  tag?: string;
  cursor?: string;
}

export function buildFeedQuery(params: FeedQueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export async function requestFeed(params: FeedQueryParams, signal?: AbortSignal): Promise<FeedDTO> {
  const res = await fetch(`/api/sac/feed${buildFeedQuery(params)}`, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new FeedApiError(await errorCodeOf(res));
  return (await res.json()) as FeedDTO;
}
