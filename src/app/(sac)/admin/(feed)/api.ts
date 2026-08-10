"use client";

import type { FeedDTO } from "@/lib/shared/types";
import { NETWORK_ERROR_MESSAGE, getJson } from "@/lib/ui/api-client";

export const FEED_ERROR_MESSAGE: Record<string, string> = {
  RATE_LIMITED: "Too many refreshes — wait a moment and try again.",
  NETWORK: NETWORK_ERROR_MESSAGE,
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
  return getJson<FeedDTO>(`/api/sac/feed${buildFeedQuery(params)}`, signal);
}
