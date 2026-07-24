"use client";

import { useCallback, useState } from "react";
import type { BoothItem } from "@/lib/shared/types";
import { Scanner, type BuyerId } from "@/lib/ui/scanner";
import { Button } from "@/lib/ui/vendor/button";
import { PosCart } from "./pos-cart";
import { type SufficiencyState, useSufficiency } from "./use-sufficiency";

const ERROR_MESSAGE: Record<string, string> = {
  NOT_FOUND: "No student matches that code or number.",
  SUSPENDED: "This account is suspended — send them to SAC.",
  RATE_LIMITED: "Too many lookups — wait a moment and try again.",
};

function errorMessage(code: string): string {
  return ERROR_MESSAGE[code] ?? "Couldn't check funds. Try again.";
}

export function BuyerPanel({
  state,
  typed,
  onClear,
}: {
  state: SufficiencyState;
  typed: boolean;
  onClear: () => void;
}) {
  return (
    <section aria-label="Buyer" className="flex flex-col gap-3 border-t border-border pt-4">
      {state.status === "error" ? (
        <p role="alert" className="text-base font-medium text-foreground">
          {errorMessage(state.code)}
        </p>
      ) : (
        <>
          <p className="text-lg font-semibold text-foreground">
            {state.status === "ready" || (state.status === "checking" && state.name)
              ? `Is this ${state.name}?`
              : "Checking…"}
          </p>
          {typed && <p className="text-sm text-muted">Ask for their student card to confirm.</p>}
          <p role="status" aria-live="polite" className="text-base font-medium">
            {state.status === "checking" && "Checking funds…"}
            {state.status === "ready" &&
              (state.sufficient ? "Funds available" : "Not enough funds")}
          </p>
        </>
      )}
      <Button type="button" variant="outline" onClick={onClear} className="self-start">
        Not them — scan again
      </Button>
    </section>
  );
}

export function PosTerminal({ boothId, items }: { boothId: string; items: BoothItem[] }) {
  const [buyer, setBuyer] = useState<BuyerId | null>(null);
  const [cartTotalCents, setCartTotalCents] = useState(0);
  const sufficiency = useSufficiency({ boothId, buyer, cartTotalCents });

  const handleTotalChange = useCallback((cents: number) => setCartTotalCents(cents), []);

  return (
    <div className="flex flex-col gap-6">
      <PosCart items={items} onTotalChange={handleTotalChange} />

      {buyer === null ? (
        <Scanner onIdentify={setBuyer} className="border-t border-border pt-4" />
      ) : (
        <BuyerPanel
          state={sufficiency}
          typed={"studentNumber" in buyer}
          onClear={() => setBuyer(null)}
        />
      )}
    </div>
  );
}
