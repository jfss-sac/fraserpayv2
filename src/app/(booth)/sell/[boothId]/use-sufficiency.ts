"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LookupResult, RecentPurchase } from "@/lib/shared/types";
import type { BuyerId } from "@/lib/ui/scanner";

export const LOOKUP_DEBOUNCE_MS = 300;
export const LOOKUP_RETRY_DELAYS_MS = [400, 1200, 3000];

const SETTLED_LOOKUP_CODES = new Set([
  "NOT_FOUND",
  "SUSPENDED",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "VALIDATION",
]);

export function isRetryableLookupCode(code: string): boolean {
  return !SETTLED_LOOKUP_CODES.has(code);
}

export interface ObservedPurchase extends RecentPurchase {
  observedAt: number;
}

interface ReadyLookup {
  status: "ready";
  name: string;
  balanceCents: number;
  lastPurchase: ObservedPurchase | null;
}

interface LookupFailure {
  status: "error";
  code: string;
  retryable: boolean;
}

export type SufficiencyState =
  | { status: "idle" }
  | { status: "checking"; name: string | null }
  | (ReadyLookup & { sufficient: boolean })
  | LookupFailure;

export class LookupError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LookupError";
  }
}

export async function requestLookup(input: {
  boothId: string;
  buyer: BuyerId;
}): Promise<LookupResult> {
  const res = await fetch("/api/booth/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    let code = "INTERNAL";
    try {
      code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? code;
    } catch {
      // fall back to INTERNAL when the body isn't a JSON envelope
    }
    throw new LookupError(code);
  }
  return (await res.json()) as LookupResult;
}

interface Resolved {
  key: string;
  buyer: BuyerId;
  attempt: number;
  name: string | null;
  state: ReadyLookup | LookupFailure;
}

export function useSufficiency(args: {
  boothId: string;
  buyer: BuyerId | null;
  cartTotalCents: number;
  debounceMs?: number;
}): { state: SufficiencyState; refresh: () => void } {
  const { boothId, buyer, cartTotalCents, debounceMs = LOOKUP_DEBOUNCE_MS } = args;
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [attempt, setAttempt] = useState(0);
  const seqRef = useRef(0);

  const key = buyer ? `${boothId}|${JSON.stringify(buyer)}` : null;

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!buyer || key === null) {
      seqRef.current += 1;
      return;
    }
    const seq = (seqRef.current += 1);
    let timer: ReturnType<typeof setTimeout>;

    const attemptLookup = (tries: number) => {
      const delayMs = tries === 0 ? debounceMs : (LOOKUP_RETRY_DELAYS_MS[tries - 1] ?? 0);
      timer = setTimeout(() => {
        requestLookup({ boothId, buyer })
          .then((result) => {
            if (seq !== seqRef.current) return;
            setResolved({
              key,
              buyer,
              attempt,
              name: result.name,
              state: {
                status: "ready",
                name: result.name,
                balanceCents: result.balanceCents,
                lastPurchase: result.lastPurchase && {
                  ...result.lastPurchase,
                  observedAt: Date.now(),
                },
              },
            });
          })
          .catch((err) => {
            if (seq !== seqRef.current) return;
            const code = err instanceof LookupError ? err.code : "NETWORK";
            const retryable = isRetryableLookupCode(code);
            if (retryable && tries < LOOKUP_RETRY_DELAYS_MS.length) {
              attemptLookup(tries + 1);
              return;
            }
            setResolved({
              key,
              buyer,
              attempt,
              name: null,
              state: { status: "error", code, retryable },
            });
          });
      }, delayMs);
    };

    attemptLookup(0);
    return () => {
      seqRef.current += 1;
      clearTimeout(timer);
    };
  }, [attempt, boothId, buyer, debounceMs, key]);

  if (!buyer) return { state: { status: "idle" }, refresh };
  const current = resolved?.buyer === buyer ? resolved : null;
  if (current && current.key === key && current.attempt === attempt) {
    const state =
      current.state.status === "ready"
        ? { ...current.state, sufficient: current.state.balanceCents >= cartTotalCents }
        : current.state;
    return { state, refresh };
  }
  return {
    state: { status: "checking", name: current?.name ?? null },
    refresh,
  };
}
