"use client";

import { useCallback, useRef, useState } from "react";
import type { ChargeResult } from "@/lib/shared/types";
import type { BuyerId } from "@/lib/ui/scanner";

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

async function requestCharge(args: {
  boothId: string;
  buyer: BuyerId;
  items: ChargeItem[];
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<ChargeResult> {
  const res = await fetch("/api/booth/charge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": args.idempotencyKey,
    },
    body: JSON.stringify({ boothId: args.boothId, buyer: args.buyer, items: args.items }),
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
  return (await res.json()) as ChargeResult;
}

export async function chargeWithRetry(
  args: { boothId: string; buyer: BuyerId; items: ChargeItem[]; idempotencyKey: string },
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<ChargeResult> {
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
}

export function useCharge(args: {
  boothId: string;
  onSuccess?: (result: { amountCents: number; entryId: string; buyerName: string }) => void;
  onError?: (code: string) => void;
}) {
  const { boothId, onSuccess, onError } = args;
  const [state, setState] = useState<ChargeState>({ status: "idle" });
  const inFlight = useRef(false);

  const submit = useCallback(
    async ({ buyer, buyerName, items }: ChargeSubmission) => {
      if (inFlight.current || items.length === 0) return;
      inFlight.current = true;
      setState({ status: "pending" });
      const idempotencyKey = crypto.randomUUID();
      try {
        const result = await chargeWithRetry({ boothId, buyer, items, idempotencyKey });
        setState({ status: "success", amountCents: result.amountCents, buyerName });
        onSuccess?.({ ...result, buyerName });
      } catch (err) {
        const code = err instanceof ChargeError ? err.code : "NETWORK";
        setState({ status: "error", code });
        onError?.(code);
      } finally {
        inFlight.current = false;
      }
    },
    [boothId, onSuccess, onError],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, submit, reset };
}
