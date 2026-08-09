"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ChargeResult } from "@/lib/shared/types";
import {
  type PendingCharge,
  clearPendingCharge,
  usePendingCharge,
  writePendingCharge,
} from "@/lib/ui/pending-charge";
import type { BuyerId } from "@/lib/ui/scanner";
import { useIdempotencyKey } from "@/lib/ui/use-idempotency-key";

export const CHARGE_TIMEOUT_MS = 15000;
export const CHARGE_MAX_ATTEMPTS = 3;

export const CHARGE_ERROR_MESSAGE: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Balance can't cover this cart.",
  SUSPENDED: "This account is suspended — send them to SAC.",
  BOOTH_NOT_SELLABLE: "This booth can't sell right now.",
  RATE_LIMITED: "Too many charges — wait a moment and try again.",
  NOT_FOUND: "No student matches that code or number.",
  IDEMPOTENCY_CONFLICT: "That charge is still going through — check the wallet before retrying.",
  VALIDATION: "Something about this cart is invalid — rebuild it and try again.",
  NETWORK: "Couldn't reach the server. Check your connection and try again.",
};

export function chargeErrorMessage(code: string): string {
  return CHARGE_ERROR_MESSAGE[code] ?? "Charge failed. Try again.";
}

export interface ChargeItem {
  itemId: string;
  qty: number;
}

export function cartToItems(quantities: Record<string, number>): ChargeItem[] {
  return Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([itemId, qty]) => ({ itemId, qty }));
}

export class ChargeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ChargeError";
  }
}

function chargeBody({
  boothId,
  buyer,
  items,
}: {
  boothId: string;
  buyer: BuyerId;
  items: ChargeItem[];
}) {
  return { boothId, buyer, items };
}

export interface ChargeOutcome extends ChargeResult {
  replayed: boolean;
}

async function requestCharge(args: {
  boothId: string;
  buyer: BuyerId;
  items: ChargeItem[];
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<ChargeOutcome> {
  const res = await fetch("/api/booth/charge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": args.idempotencyKey,
    },
    body: JSON.stringify(chargeBody(args)),
    signal: args.signal,
  });
  if (!res.ok) {
    let code = "INTERNAL";
    try {
      code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? code;
    } catch {
      // non-JSON body: fall back to INTERNAL
    }
    throw new ChargeError(code);
  }
  const replayed = res.headers.get("idempotent-replay") === "true";
  return { ...((await res.json()) as ChargeResult), replayed };
}

export async function chargeWithRetry(
  args: { boothId: string; buyer: BuyerId; items: ChargeItem[]; idempotencyKey: string },
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<ChargeOutcome> {
  const attempts = opts.attempts ?? CHARGE_MAX_ATTEMPTS;
  const timeoutMs = opts.timeoutMs ?? CHARGE_TIMEOUT_MS;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await requestCharge({ ...args, signal: controller.signal });
    } catch (err) {
      if (err instanceof ChargeError) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ChargeError("NETWORK");
}

export type ChargeState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; amountCents: number; buyerName: string }
  | { status: "error"; code: string };

export interface ChargeSubmission {
  buyer: BuyerId;
  buyerName: string;
  items: ChargeItem[];
  amountCents: number;
}

const SETTLED_CHARGE_CODES = new Set(["INSUFFICIENT_FUNDS", "BOOTH_NOT_SELLABLE"]);

export function useCharge(args: {
  boothId: string;
  actorUid: string;
  onSuccess?: (result: {
    amountCents: number;
    entryId: string;
    buyerName: string;
    recovered: boolean;
    replayed: boolean;
  }) => void;
  onError?: (code: string) => void;
}) {
  const { boothId, actorUid, onSuccess, onError } = args;
  const [state, setState] = useState<ChargeState>({ status: "idle" });
  const [sessionId] = useState(() => crypto.randomUUID());
  const inFlight = useRef(false);
  const { keyFor, hold, isHeld, release, releaseAll } = useIdempotencyKey();
  const scope = useMemo(() => ({ actorUid, boothId }), [actorUid, boothId]);
  const persisted = usePendingCharge(scope);
  const recovered = persisted && persisted.sessionId !== sessionId ? persisted : null;

  const run = useCallback(
    async (
      { buyer, buyerName, items, amountCents }: ChargeSubmission,
      replay: PendingCharge | null,
    ) => {
      if (inFlight.current || items.length === 0) return;
      inFlight.current = true;
      setState({ status: "pending" });
      const body = chargeBody({ boothId, buyer, items });
      if (replay) hold("/api/booth/charge", body, replay.key);
      const reusedKey = isHeld("/api/booth/charge", body);
      const idempotencyKey = keyFor("/api/booth/charge", body);
      writePendingCharge(scope, {
        key: idempotencyKey,
        sessionId: replay?.sessionId ?? sessionId,
        buyer,
        buyerName,
        items,
        amountCents,
        startedAt: replay?.startedAt ?? Date.now(),
      });
      try {
        const { replayed, ...result } = await chargeWithRetry({
          boothId,
          buyer,
          items,
          idempotencyKey,
        });
        release("/api/booth/charge", body);
        clearPendingCharge(scope);
        setState({ status: "success", amountCents: result.amountCents, buyerName });
        onSuccess?.({
          ...result,
          buyerName,
          recovered: replay !== null,
          replayed: replayed && reusedKey,
        });
      } catch (err) {
        const code = err instanceof ChargeError ? err.code : "NETWORK";
        if (SETTLED_CHARGE_CODES.has(code)) clearPendingCharge(scope);
        setState({ status: "error", code });
        onError?.(code);
      } finally {
        inFlight.current = false;
      }
    },
    [boothId, scope, sessionId, onSuccess, onError, keyFor, hold, isHeld, release],
  );

  const submit = useCallback((submission: ChargeSubmission) => run(submission, null), [run]);

  const retryRecovered = useCallback(
    (pending: PendingCharge) =>
      run(
        {
          buyer: pending.buyer,
          buyerName: pending.buyerName,
          items: pending.items,
          amountCents: pending.amountCents,
        },
        pending,
      ),
    [run],
  );

  const dismissRecovered = useCallback(() => {
    if (recovered) {
      release(
        "/api/booth/charge",
        chargeBody({ boothId, buyer: recovered.buyer, items: recovered.items }),
      );
    }
    clearPendingCharge(scope);
  }, [recovered, boothId, release, scope]);

  const reset = useCallback(() => {
    releaseAll();
    clearPendingCharge(scope);
    setState({ status: "idle" });
  }, [releaseAll, scope]);

  return { state, submit, reset, recovered, retryRecovered, dismissRecovered };
}
