import "server-only";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { InternalError, RateLimitedError } from "./errors";
import { getAdminFirestore } from "./firebase-admin";
import { logger } from "./logger";

export interface RateLimitRule {
  key: "ip" | "uid";
  limit: number;
  windowMs: number;
  failOpen: boolean;
}

const MINUTE = 60_000;

export const RATE_LIMITS = {
  "auth-session": { key: "ip", limit: 10, windowMs: 5 * MINUTE, failOpen: false },
  register: { key: "uid", limit: 10, windowMs: 10 * MINUTE, failOpen: false },
  join: { key: "uid", limit: 10, windowMs: 10 * MINUTE, failOpen: false },
  lookup: { key: "uid", limit: 30, windowMs: MINUTE, failOpen: true },
  charge: { key: "uid", limit: 20, windowMs: MINUTE, failOpen: false },
  topup: { key: "uid", limit: 20, windowMs: MINUTE, failOpen: false },
  "exec-mutations": { key: "uid", limit: 30, windowMs: MINUTE, failOpen: false },
  reads: { key: "uid", limit: 60, windowMs: MINUTE, failOpen: true },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export async function checkRateLimit(scope: RateLimitScope, key: string): Promise<void> {
  const rule = RATE_LIMITS[scope];
  const now = Date.now();
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const windowEnd = windowStart + rule.windowMs;
  const retryAfter = Math.ceil((windowEnd - now) / 1000);
  const ref = getAdminFirestore().collection("rateLimits").doc(`${scope}_${key}_${windowStart}`);

  let count: number;
  try {
    await ref.set(
      { count: FieldValue.increment(1), expiresAt: Timestamp.fromMillis(windowEnd) },
      { merge: true },
    );
    const snap = await ref.get();
    count = (snap.data()?.count as number | undefined) ?? 1;
  } catch (err) {
    if (rule.failOpen) {
      logger.warn({ event: "ratelimit_unavailable", code: scope, err });
      return;
    }
    logger.error({ event: "ratelimit_unavailable", code: scope, err });
    throw new InternalError();
  }

  if (count > rule.limit) throw new RateLimitedError(retryAfter);
}
