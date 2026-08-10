import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { InternalError, RateLimitedError } from "./errors";
import { getAdminFirestore } from "./firebase-admin";
import { logger } from "./logger";

export interface RateLimitRule {
  key: "uid";
  limit: number;
  windowMs: number;
  failOpen: boolean;
}

const MINUTE = 60_000;

export const RATE_LIMITS = {
  register: { key: "uid", limit: 20, windowMs: 10 * MINUTE, failOpen: false },
  join: { key: "uid", limit: 20, windowMs: 10 * MINUTE, failOpen: false },
  lookup: { key: "uid", limit: 120, windowMs: MINUTE, failOpen: true },
  charge: { key: "uid", limit: 120, windowMs: MINUTE, failOpen: false },
  topup: { key: "uid", limit: 40, windowMs: MINUTE, failOpen: false },
  "exec-mutations": { key: "uid", limit: 60, windowMs: MINUTE, failOpen: false },
  reads: { key: "uid", limit: 120, windowMs: MINUTE, failOpen: true },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

export const NOTABLE_WINDOW_REQUESTS = 20;

export interface RateLimitTicket {
  scope: RateLimitScope;
  docId: string;
}

export async function checkRateLimit(
  scope: RateLimitScope,
  key: string,
): Promise<RateLimitTicket | null> {
  const rule = RATE_LIMITS[scope];
  const now = Date.now();
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const windowEnd = windowStart + rule.windowMs;
  const retryAfter = Math.ceil((windowEnd - now) / 1000);
  const docId = `${scope}_${key}_${windowStart}`;
  const ref = getAdminFirestore().collection("rateLimits").doc(docId);

  let count: number;
  let refunds: number;
  try {
    await ref.set(
      {
        count: FieldValue.increment(1),
        scope,
        uid: key,
        windowStart: Timestamp.fromMillis(windowStart),
        expiresAt: Timestamp.fromMillis(windowEnd + RATE_LIMIT_RETENTION_MS),
      },
      { merge: true },
    );
    const data = (await ref.get()).data();
    count = (data?.count as number | undefined) ?? 1;
    refunds = (data?.refunds as number | undefined) ?? 0;
  } catch (err) {
    if (rule.failOpen) {
      logger.warn({ event: "ratelimit_unavailable", code: scope, err });
      return null;
    }
    logger.error({ event: "ratelimit_unavailable", code: scope, err });
    throw new InternalError();
  }

  if (count - Math.min(refunds, rule.limit) > rule.limit) throw new RateLimitedError(retryAfter);
  return { scope, docId };
}

export async function releaseRateLimit(ticket: RateLimitTicket | null): Promise<void> {
  if (!ticket) return;
  try {
    await getAdminFirestore()
      .collection("rateLimits")
      .doc(ticket.docId)
      .update({ refunds: FieldValue.increment(1) });
  } catch (err) {
    logger.warn({ event: "ratelimit_release_failed", code: ticket.scope, err });
  }
}
