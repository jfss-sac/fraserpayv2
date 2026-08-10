import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { rateLimitsCol, usersCol } from "./db";
import { getAdminFirestore } from "./firebase-admin";
import { NOTABLE_WINDOW_REQUESTS, RATE_LIMITS, type RateLimitScope } from "./ratelimit";
import type { ActivityActor, ActivityDTO, ActivityScopeUsage } from "@/lib/shared/types";

export const ACTIVITY_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const ACTIVITY_SCAN_LIMIT = 500;

export interface ActivityWindow {
  uid: string;
  scope: RateLimitScope;
  requests: number;
  windowStartMs: number;
}

export interface ActivityActorName {
  displayName: string;
  suspended: boolean;
}

function isKnownScope(scope: string): scope is RateLimitScope {
  return scope in RATE_LIMITS;
}

export function buildActivity(args: {
  windows: ActivityWindow[];
  names: Map<string, ActivityActorName>;
  truncated: boolean;
}): ActivityDTO {
  const byActor = new Map<
    string,
    { scopes: Map<RateLimitScope, ActivityScopeUsage>; totalRequests: number; lastSeenMs: number }
  >();

  for (const window of args.windows) {
    const rule = RATE_LIMITS[window.scope];
    const actor = byActor.get(window.uid) ?? {
      scopes: new Map<RateLimitScope, ActivityScopeUsage>(),
      totalRequests: 0,
      lastSeenMs: 0,
    };
    const usage = actor.scopes.get(window.scope) ?? {
      scope: window.scope,
      peakRequests: 0,
      limit: rule.limit,
      windowMs: rule.windowMs,
      blockedWindows: 0,
    };
    usage.peakRequests = Math.max(usage.peakRequests, window.requests);
    if (window.requests > rule.limit) usage.blockedWindows += 1;
    actor.scopes.set(window.scope, usage);
    actor.totalRequests += window.requests;
    actor.lastSeenMs = Math.max(actor.lastSeenMs, window.windowStartMs);
    byActor.set(window.uid, actor);
  }

  const actors: ActivityActor[] = [...byActor].map(([uid, actor]) => {
    const scopes = [...actor.scopes.values()].sort((a, b) => b.peakRequests - a.peakRequests);
    const name = args.names.get(uid);
    return {
      uid,
      displayName: name?.displayName ?? "Unknown account",
      suspended: name?.suspended ?? false,
      totalRequests: actor.totalRequests,
      peakRequests: scopes.reduce((peak, s) => Math.max(peak, s.peakRequests), 0),
      blockedWindows: scopes.reduce((sum, s) => sum + s.blockedWindows, 0),
      lastSeenIso: new Date(actor.lastSeenMs).toISOString(),
      scopes,
    };
  });

  actors.sort(
    (a, b) =>
      b.blockedWindows - a.blockedWindows ||
      b.peakRequests - a.peakRequests ||
      b.totalRequests - a.totalRequests ||
      a.displayName.localeCompare(b.displayName),
  );

  return {
    actors,
    notableThreshold: NOTABLE_WINDOW_REQUESTS,
    lookbackMs: ACTIVITY_LOOKBACK_MS,
    truncated: args.truncated,
  };
}

export async function getActivity(nowMs: number = Date.now()): Promise<ActivityDTO> {
  const cutoffMs = nowMs - ACTIVITY_LOOKBACK_MS;
  const snap = await rateLimitsCol()
    .where("count", ">=", NOTABLE_WINDOW_REQUESTS)
    .where("windowStart", ">=", Timestamp.fromMillis(cutoffMs))
    .orderBy("count", "desc")
    .orderBy("windowStart", "desc")
    .limit(ACTIVITY_SCAN_LIMIT)
    .get();

  const windows: ActivityWindow[] = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.uid || !data.scope || !data.windowStart || !isKnownScope(data.scope)) continue;
    windows.push({
      uid: data.uid,
      scope: data.scope,
      requests: data.count,
      windowStartMs: data.windowStart.toMillis(),
    });
  }

  const uids = [...new Set(windows.map((w) => w.uid))];
  const names = new Map<string, ActivityActorName>();
  if (uids.length > 0) {
    const userSnaps = await getAdminFirestore().getAll(...uids.map((uid) => usersCol().doc(uid)));
    for (const userSnap of userSnaps) {
      const user = userSnap.data();
      if (user)
        names.set(userSnap.id, { displayName: user.displayName, suspended: user.suspended });
    }
  }

  return buildActivity({
    windows,
    names,
    truncated: snap.size === ACTIVITY_SCAN_LIMIT,
  });
}
