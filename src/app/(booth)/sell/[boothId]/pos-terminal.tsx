"use client";

import { useCallback, useState } from "react";
import { BOOTH_STUDENT_NUMBER_ENABLED } from "@/lib/shared/constants";
import { formatCents } from "@/lib/shared/money";
import type { BoothItem } from "@/lib/shared/types";
import { Scanner, type BuyerId } from "@/lib/ui/scanner";
import { useToast } from "@/lib/ui/toast";
import { useNow } from "@/lib/ui/use-now";
import { Button } from "@/lib/ui/vendor/button";
import { OfflineBanner } from "./offline-banner";
import { type CartQuantities, PosCart } from "./pos-cart";
import { RecoveryCard } from "./recovery-card";
import { useConnectivity } from "./use-connectivity";
import { cartToItems, chargeErrorMessage, useCharge } from "./use-charge";
import { type ObservedPurchase, type SufficiencyState, useSufficiency } from "./use-sufficiency";

export const LAST_CHARGE_TICK_MS = 5000;

const ERROR_MESSAGE: Record<string, string> = {
  NOT_FOUND: "No student matches that code or number.",
  SUSPENDED: "This account is suspended — send them to SAC.",
  RATE_LIMITED: "Too many lookups — wait a moment and try again.",
};

function errorMessage(code: string): string {
  return ERROR_MESSAGE[code] ?? "Couldn't check funds. Try again.";
}

function possiblySameBuyer(a: BuyerId, b: BuyerId): boolean {
  if ("paymentCode" in a && "paymentCode" in b) return a.paymentCode === b.paymentCode;
  if ("studentNumber" in a && "studentNumber" in b) return a.studentNumber === b.studentNumber;
  return true;
}

export function formatAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export function LastChargeNote({ purchase }: { purchase: ObservedPurchase }) {
  const now = useNow(LAST_CHARGE_TICK_MS);
  const ageMs = purchase.ageMs + Math.max(0, now - purchase.observedAt);
  return (
    <p className="text-sm font-semibold text-warning">
      Already charged {formatCents(purchase.amountCents)} here — {formatAge(ageMs)}
    </p>
  );
}

export function BuyerPanel({
  state,
  onClear,
  onRefresh,
}: {
  state: SufficiencyState;
  onClear: () => void;
  onRefresh: () => void;
}) {
  return (
    <section aria-label="Buyer" className="flex flex-col gap-3 border-t border-border pt-4">
      {state.status === "error" ? (
        <>
          <p role="alert" className="text-base font-medium text-foreground">
            {errorMessage(state.code)}
          </p>
          {state.retryable && (
            <Button type="button" onClick={onRefresh} className="self-start">
              Try again
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-lg font-semibold text-foreground">
            {state.status === "ready" || (state.status === "checking" && state.name)
              ? `Is this ${state.name}?`
              : "Checking…"}
          </p>
          <p className="text-sm text-muted">Ask for their student card to confirm.</p>
          {state.status === "ready" && (
            <p className="text-base font-medium text-foreground">
              Balance {formatCents(state.balanceCents)}
            </p>
          )}
          <p role="status" aria-live="polite" className="text-base font-medium">
            {state.status === "checking" && "Checking funds…"}
            {state.status === "ready" &&
              (state.sufficient ? "Funds available" : "Not enough funds")}
          </p>
          {state.status === "ready" && state.lastPurchase && (
            <LastChargeNote purchase={state.lastPurchase} />
          )}
          {state.status === "ready" && (
            <Button type="button" variant="outline" onClick={onRefresh} className="self-start">
              Refresh balance
            </Button>
          )}
        </>
      )}
      <Button type="button" variant="outline" onClick={onClear} className="self-start">
        Not them — scan again
      </Button>
    </section>
  );
}

export function PosTerminal({
  boothId,
  actorUid,
  items,
}: {
  boothId: string;
  actorUid: string;
  items: BoothItem[];
}) {
  const [buyer, setBuyer] = useState<BuyerId | null>(null);
  const [cartTotalCents, setCartTotalCents] = useState(0);
  const [cartKey, setCartKey] = useState(0);
  const { state: sufficiency, refresh: refreshLookup } = useSufficiency({
    boothId,
    buyer,
    cartTotalCents,
  });
  const online = useConnectivity();
  const { push } = useToast();

  const {
    state: chargeState,
    submit,
    recovered,
    retryRecovered,
    dismissRecovered,
  } = useCharge({
    boothId,
    actorUid,
    onSuccess: ({ amountCents, buyerName, recovered: wasRecovered, replayed }) => {
      if (replayed) {
        push(
          `Already processed — no new charge. ${formatCents(amountCents)} to ${buyerName} had already gone through.`,
          "success",
        );
      } else if (wasRecovered) {
        push(
          `Unfinished charge resolved — ${formatCents(amountCents)} to ${buyerName} went through. No second charge.`,
          "success",
        );
      } else {
        push(`Charged ${formatCents(amountCents)} to ${buyerName}`, "success");
      }
      const saleBelongsToAnotherBuyer =
        wasRecovered &&
        buyer !== null &&
        recovered !== null &&
        !possiblySameBuyer(buyer, recovered.buyer);
      if (!saleBelongsToAnotherBuyer) {
        setBuyer(null);
        setCartKey((key) => key + 1);
      }
    },
    onError: (code) => {
      if (code === "INSUFFICIENT_FUNDS") refreshLookup();
      push(chargeErrorMessage(code), "error");
    },
  });

  const handleTotalChange = useCallback((cents: number) => setCartTotalCents(cents), []);

  const buyerName = sufficiency.status === "ready" ? sufficiency.name : null;

  const handleCharge = useCallback(
    (quantities: CartQuantities) => {
      if (!buyer || !buyerName) return;
      submit({
        buyer,
        buyerName,
        items: cartToItems(quantities),
        amountCents: cartTotalCents,
      });
    },
    [buyer, buyerName, cartTotalCents, submit],
  );

  const canCharge = buyer !== null && sufficiency.status === "ready" && online;
  const busy = chargeState.status === "pending";

  return (
    <div className="flex flex-col gap-6">
      {!online && <OfflineBanner />}

      {recovered && (
        <RecoveryCard
          pending={recovered}
          busy={busy}
          online={online}
          onRetry={retryRecovered}
          onDismiss={dismissRecovered}
        />
      )}

      <PosCart
        key={cartKey}
        items={items}
        onTotalChange={handleTotalChange}
        onCharge={canCharge ? handleCharge : undefined}
        busy={busy}
      />

      {buyer === null ? (
        <Scanner
          onIdentify={setBuyer}
          manualEntry={BOOTH_STUDENT_NUMBER_ENABLED ? "studentNumber" : "paymentCode"}
          className="border-t border-border pt-4"
        />
      ) : (
        <BuyerPanel state={sufficiency} onClear={() => setBuyer(null)} onRefresh={refreshLookup} />
      )}
    </div>
  );
}
