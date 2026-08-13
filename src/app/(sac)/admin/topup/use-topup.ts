"use client";

import { useCallback, useRef, useState } from "react";
import type { PaymentMethod, SacLookupResult, TopUpResult } from "@/lib/shared/types";
import { ApiError, NETWORK_ERROR_MESSAGE, apiErrorOf } from "@/lib/ui/api-client";
import {
  type PendingTopUp,
  clearPendingTopUp,
  usePendingTopUps,
  writePendingTopUp,
} from "@/lib/ui/pending-topup";
import type { BuyerId } from "@/lib/ui/scanner";
import { useIdempotencyKey } from "@/lib/ui/use-idempotency-key";

export const TOPUP_TIMEOUT_MS = 15000;
export const TOPUP_MAX_ATTEMPTS = 3;

export const LOOKUP_ERROR_MESSAGE: Record<string, string> = {
  NOT_FOUND: "No student matches that code or number.",
  SUSPENDED: "This account is suspended — send them to an exec.",
  RATE_LIMITED: "Too many lookups — wait a moment and try again.",
  NETWORK: NETWORK_ERROR_MESSAGE,
};

export const TOPUP_ERROR_MESSAGE: Record<string, string> = {
  CAP_EXCEEDED: "Over the $100 top-up / $200 balance cap — an exec can override with a reason.",
  SUSPENDED: "This account is suspended — it can't be topped up.",
  FORBIDDEN: "You can't top up your own account — another SAC member must do it.",
  NOT_FOUND: "No student matches that code or number.",
  RATE_LIMITED: "Too many top-ups — wait a moment and try again.",
  IDEMPOTENCY_CONFLICT: "That top-up is still going through — check the wallet before retrying.",
  VALIDATION: "That amount isn't valid — use 50¢ increments.",
  NETWORK: NETWORK_ERROR_MESSAGE,
};

export function lookupErrorMessage(code: string): string {
  return LOOKUP_ERROR_MESSAGE[code] ?? "Couldn't look that student up. Try again.";
}

export function topUpErrorMessage(code: string, serverMessage = ""): string {
  if (code === "FORBIDDEN") return serverMessage || TOPUP_ERROR_MESSAGE.FORBIDDEN!;
  return TOPUP_ERROR_MESSAGE[code] ?? "Top-up failed. Try again.";
}

export async function requestSacLookup(buyer: BuyerId): Promise<SacLookupResult> {
  const res = await fetch("/api/sac/lookup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ buyer }),
  });
  if (!res.ok) throw await apiErrorOf(res);
  return (await res.json()) as SacLookupResult;
}

export interface TopUpSubmission {
  buyer: BuyerId;
  studentName: string;
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

export interface TopUpOutcome extends TopUpResult {
  replayed: boolean;
}

async function requestTopUp(
  submission: TopUpSubmission & { idempotencyKey: string; signal: AbortSignal },
): Promise<TopUpOutcome> {
  const { idempotencyKey, signal } = submission;
  const res = await fetch("/api/sac/topup", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(topUpBody(submission)),
    signal,
  });
  if (!res.ok) throw await apiErrorOf(res);
  const replayed = res.headers.get("idempotent-replay") === "true";
  return { ...((await res.json()) as TopUpResult), replayed };
}

export async function topUpWithRetry(
  submission: TopUpSubmission & { idempotencyKey: string },
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<TopUpOutcome> {
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
  | {
      status: "success";
      result: TopUpResult;
      studentName: string;
      replayed: boolean;
      recovered: boolean;
    }
  | { status: "error"; code: string };

export function submissionOf(pending: PendingTopUp): TopUpSubmission {
  return {
    buyer: pending.buyer,
    studentName: pending.studentName,
    amountCents: pending.amountCents,
    method: pending.method,
    ...(pending.overrideReason ? { overrideReason: pending.overrideReason } : {}),
  };
}

// Only a code that can be raised nowhere but inside the transaction, at or after
// the replay read, proves the original never committed (arch §9.2). For topUp
// that is CAP_EXCEEDED alone: FORBIDDEN and SUSPENDED can come from the actor's
// own authorization before the handler body runs, and NOT_FOUND names a student
// who cannot be credited at all, so retaining that key costs nothing.
const SETTLED_TOPUP_CODES = new Set(["CAP_EXCEEDED"]);

export function useTopUp(args: {
  actorUid: string;
  onSuccess?: (result: TopUpResult) => void;
  onError?: (code: string, serverMessage: string) => void;
}) {
  const { actorUid, onSuccess, onError } = args;
  const [state, setState] = useState<TopUpState>({ status: "idle" });
  const [sessionId] = useState(() => crypto.randomUUID());
  const inFlight = useRef(false);
  const { keyFor, hold, isHeld, release } = useIdempotencyKey();
  const persisted = usePendingTopUps(actorUid);
  const recovered = persisted.find((record) => record.sessionId !== sessionId) ?? null;

  const run = useCallback(
    async (submission: TopUpSubmission, replay: PendingTopUp | null) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ status: "pending" });
      const body = topUpBody(submission);
      if (replay) hold("/api/sac/topup", body, replay.key);
      const reusedKey = isHeld("/api/sac/topup", body);
      const idempotencyKey = keyFor("/api/sac/topup", body);
      writePendingTopUp(actorUid, {
        key: idempotencyKey,
        sessionId: replay?.sessionId ?? sessionId,
        buyer: submission.buyer,
        studentName: submission.studentName,
        amountCents: submission.amountCents,
        method: submission.method,
        ...(submission.overrideReason ? { overrideReason: submission.overrideReason } : {}),
        startedAt: replay?.startedAt ?? Date.now(),
      });
      try {
        const { replayed, ...result } = await topUpWithRetry({ ...submission, idempotencyKey });
        release("/api/sac/topup", body);
        clearPendingTopUp(actorUid, idempotencyKey);
        setState({
          status: "success",
          result,
          studentName: submission.studentName,
          replayed: replayed && reusedKey,
          recovered: replay !== null,
        });
        onSuccess?.(result);
      } catch (err) {
        const apiError = err instanceof ApiError ? err : null;
        const code = apiError?.code ?? "NETWORK";
        if (SETTLED_TOPUP_CODES.has(code)) clearPendingTopUp(actorUid, idempotencyKey);
        setState({ status: "error", code });
        onError?.(code, apiError?.serverMessage ?? "");
      } finally {
        inFlight.current = false;
      }
    },
    [actorUid, sessionId, onSuccess, onError, keyFor, hold, isHeld, release],
  );

  const submit = useCallback((submission: TopUpSubmission) => run(submission, null), [run]);

  const retryRecovered = useCallback(
    (pending: PendingTopUp) => run(submissionOf(pending), pending),
    [run],
  );

  // Dismiss drops the record only. If Retry seeded the key into memory, it stays
  // held, so a re-rung identical top-up replays instead of crediting twice; if
  // Retry was never pressed the key was never reachable at all — re-entering by
  // hand executes for real, which is why the card says to use Retry (arch §9.2).
  const dismissRecovered = useCallback(() => {
    if (!recovered) return;
    clearPendingTopUp(actorUid, recovered.key);
  }, [recovered, actorUid]);

  // Start over must not retire an unresolved key: the same physical top-up rung
  // again would then mint a fresh key and credit the student twice (I5).
  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  return { state, submit, reset, recovered, retryRecovered, dismissRecovered };
}
