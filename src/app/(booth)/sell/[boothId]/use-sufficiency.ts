"use client";

import { useEffect, useRef, useState } from "react";
import type { LookupResult } from "@/lib/shared/types";
import type { BuyerId } from "@/lib/ui/scanner";

export const LOOKUP_DEBOUNCE_MS = 300;

export type SufficiencyState =
  | { status: "idle" }
  | { status: "checking"; name: string | null }
  | { status: "ready"; name: string; sufficient: boolean }
  | { status: "error"; code: string };

export class LookupError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LookupError";
  }
}

export async function requestLookup(input: {
  boothId: string;
  buyer: BuyerId;
  cartTotalCents: number;
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
  name: string | null;
  state: Extract<SufficiencyState, { status: "ready" | "error" }>;
}

export function useSufficiency(args: {
  boothId: string;
  buyer: BuyerId | null;
  cartTotalCents: number;
  debounceMs?: number;
}): SufficiencyState {
  const { boothId, buyer, cartTotalCents, debounceMs = LOOKUP_DEBOUNCE_MS } = args;
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const seqRef = useRef(0);

  const key = buyer ? `${boothId}|${JSON.stringify(buyer)}|${cartTotalCents}` : null;

  useEffect(() => {
    if (!buyer || key === null) {
      seqRef.current += 1;
      return;
    }
    const seq = (seqRef.current += 1);
    const timer = setTimeout(() => {
      requestLookup({ boothId, buyer, cartTotalCents })
        .then((result) => {
          if (seq !== seqRef.current) return;
          setResolved({
            key,
            buyer,
            name: result.name,
            state: { status: "ready", name: result.name, sufficient: result.sufficient },
          });
        })
        .catch((err) => {
          if (seq !== seqRef.current) return;
          setResolved({
            key,
            buyer,
            name: null,
            state: {
              status: "error",
              code: err instanceof LookupError ? err.code : "INTERNAL",
            },
          });
        });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [boothId, buyer, cartTotalCents, debounceMs, key]);

  if (!buyer) return { status: "idle" };
  if (resolved && resolved.key === key) return resolved.state;
  return { status: "checking", name: resolved && resolved.buyer === buyer ? resolved.name : null };
}
