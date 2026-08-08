"use client";

import { useCallback, useRef, useState } from "react";
import type { PaymentMethod, SacLookupResult, TopUpResult } from "@/lib/shared/types";
import type { BuyerId } from "@/lib/ui/scanner";
import { useIdempotencyKey } from "@/lib/ui/use-idempotency-key";

export const TOPUP_TIMEOUT_MS = 15000;
export const TOPUP_MAX_ATTEMPTS = 3;

export const LOOKUP_ERROR_MESSAGE: Record<string, string> = {
  NOT_FOUND: "No student matches that code or number.",
  SUSPENDED: "This account is suspended — send them to an exec.",
  RATE_LIMITED: "Too many lookups — wait a moment and try again.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
};

export const TOPUP_ERROR_MESSAGE: Record<string, string> = {
  CAP_EXCEEDED: "Over the $100 top-up / $200 balance cap — an exec can override with a reason.",
  SUSPENDED: "This account is suspended — it can't be topped up.",
  FORBIDDEN: "You can't top up your own account — another SAC member must do it.",
  NOT_FOUND: "No student matches that code or number.",
  RATE_LIMITED: "Too many top-ups — wait a moment and try again.",
  IDEMPOTENCY_CONFLICT: "That top-up is still going through — check the wallet before retrying.",
  VALIDATION: "That amount isn't valid — use 50¢ increments.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
};

export function lookupErrorMessage(code: string): string {
  return LOOKUP_ERROR_MESSAGE[code] ?? "Couldn't look that student up. Try again.";
}

export function topUpErrorMessage(code: string): string {
  return TOPUP_ERROR_MESSAGE[code] ?? "Top-up failed. Try again.";
}

async function errorCodeOf(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: { code?: string } }).error?.code ?? "INTERNAL";
  } catch {
    return "INTERNAL";
  }
}

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

export async function requestSacLookup(buyer: BuyerId): Promise<SacLookupResult> {
  const res = await fetch("/api/sac/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ buyer }),
  });
  if (!res.ok) throw new ApiError(await errorCodeOf(res));
  return (await res.json()) as SacLookupResult;
}

export interface TopUpSubmission {
  buyer: BuyerId;
  amountCents: number;
  method: PaymentMethod;
  overrideReason?: string;
}

function topUpBody({ buyer, amountCents, method, overrideReason }: TopUpSubmission) {
  return {
    buyer,
    amountCents,
    method,
    ...(overrideReason ? { overrideReason } : {}),
  };
}

async function requestTopUp(
  submission: TopUpSubmission & { idempotencyKey: string; signal: AbortSignal },
): Promise<TopUpResult> {
  const { idempotencyKey, signal } = submission;
  const res = await fetch("/api/sac/topup", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(topUpBody(submission)),
    signal,
  });
  if (!res.ok) throw new ApiError(await errorCodeOf(res));
  return (await res.json()) as TopUpResult;
}

export async function topUpWithRetry(
  submission: TopUpSubmission & { idempotencyKey: string },
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<TopUpResult> {
  const attempts = opts.attempts ?? TOPUP_MAX_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? TOPUP_TIMEOUT_MS;
  for (let i = 0; i < attempts; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await requestTopUp({ ...submission, signal: controller.signal });
    } catch (err) {
      if (err instanceof ApiError) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ApiError("NETWORK");
}

export type TopUpState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; result: TopUpResult }
  | { status: "error"; code: string };

export function useTopUp(args: {
  onSuccess?: (result: TopUpResult) => void;
  onError?: (code: string) => void;
}) {
  const { onSuccess, onError } = args;
  const [state, setState] = useState<TopUpState>({ status: "idle" });
  const inFlight = useRef(false);
  const { keyFor, release, releaseAll } = useIdempotencyKey();

  const submit = useCallback(
    async (submission: TopUpSubmission) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ status: "pending" });
      const body = topUpBody(submission);
      const idempotencyKey = keyFor("/api/sac/topup", body);
      try {
        const result = await topUpWithRetry({ ...submission, idempotencyKey });
        release("/api/sac/topup", body);
        setState({ status: "success", result });
        onSuccess?.(result);
      } catch (err) {
        const code = err instanceof ApiError ? err.code : "NETWORK";
        setState({ status: "error", code });
        onError?.(code);
      } finally {
        inFlight.current = false;
      }
    },
    [onSuccess, onError, keyFor, release],
  );

  const reset = useCallback(() => {
    releaseAll();
    setState({ status: "idle" });
  }, [releaseAll]);

  return { state, submit, reset };
}
