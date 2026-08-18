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
import {
  cartTotalCents as calculateCartTotalCents,
  type CartQuantities,
  PosCart,
} from "./pos-cart";
import { RecoveryCard } from "./recovery-card";
import { type CatalogChange, CATALOG_REFRESH_ERROR, useCatalog } from "./use-catalog";
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

function catalogChangeLabel(change: CatalogChange): string {
  if (change.type === "price") {
    return `${change.name} ${formatCents(change.previousPriceCents)} → ${formatCents(change.priceCents)}`;
  }
  if (change.type === "archived") {
    return `${change.name} — no longer sold (removed from cart)`;
  }
  return `${change.name} added at ${formatCents(change.priceCents)}`;
}

export function CatalogChangeNotice({
  changes,
  confirmationRequired,
  confirmationAvailable,
  onConfirm,
}: {
  changes: CatalogChange[];
  confirmationRequired: boolean;
  confirmationAvailable: boolean;
  onConfirm: () => void;
}) {
  if (changes.length === 0 && !confirmationRequired) return null;

  return (
    <section
      aria-label="Catalog changes"
      role={confirmationRequired ? "alert" : "status"}
      className="flex flex-col gap-3 rounded-lg border border-warning bg-surface p-4"
    >
      <p className="font-medium text-foreground">
        {confirmationRequired && confirmationAvailable
          ? "Review the catalog changes before charging again."
          : confirmationRequired
            ? "Refresh the catalog before charging again."
            : "Catalog updated."}
      </p>
      {changes.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-foreground">
          {changes.map((change) => (
            <li key={`${change.type}-${change.itemId}`}>{catalogChangeLabel(change)}</li>
          ))}
        </ul>
      )}
      {confirmationRequired && confirmationAvailable && (
        <Button type="button" variant="outline" onClick={onConfirm} className="self-start">
          Confirm price changes
        </Button>
      )}
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
  const {
    items: catalogItems,
    changes: catalogChanges,
    isRefreshing: catalogRefreshing,
    error: catalogError,
    refresh: requestCatalogRefresh,
    clearChanges: clearCatalogChanges,
  } = useCatalog({ boothId, initialItems: items });
  const [buyer, setBuyer] = useState<BuyerId | null>(null);
  const [cartTotalCents, setCartTotalCents] = useState(0);
  const [cartQuantities, setCartQuantities] = useState<CartQuantities>({});
  const [catalogConfirmationRequired, setCatalogConfirmationRequired] = useState(false);
  const [catalogConfirmationAvailable, setCatalogConfirmationAvailable] = useState(false);
  const [catalogWasRefreshed, setCatalogWasRefreshed] = useState(false);
  const { state: sufficiency, refresh: refreshLookup } = useSufficiency({
    boothId,
    buyer,
    cartTotalCents,
  });
  const online = useConnectivity();
  const { push } = useToast();

  const refreshCatalog = useCallback(
    async (requiresConfirmation = false) => {
      const confirmationWasRequired = catalogConfirmationRequired;
      const shouldGate = requiresConfirmation || confirmationWasRequired;
      if (shouldGate) {
        setCatalogConfirmationRequired(true);
        setCatalogConfirmationAvailable(false);
      }
      const result = await requestCatalogRefresh();
      if (!result) {
        push(CATALOG_REFRESH_ERROR, "error");
        return null;
      }
      setCatalogWasRefreshed(true);
      const archivedIds = new Set(
        result.changes
          .filter(
            (change): change is Extract<CatalogChange, { type: "archived" }> =>
              change.type === "archived",
          )
          .map((change) => change.itemId),
      );
      if (archivedIds.size > 0) {
        setCartQuantities((current) => {
          const next = Object.fromEntries(
            Object.entries(current).filter(([itemId]) => !archivedIds.has(itemId)),
          );
          return Object.keys(next).length === Object.keys(current).length ? current : next;
        });
      }
      if (shouldGate) {
        setCatalogConfirmationRequired(true);
        setCatalogConfirmationAvailable(true);
      }
      return result;
    },
    [catalogConfirmationRequired, push, requestCatalogRefresh],
  );

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
        setCartQuantities({});
      }
      clearCatalogChanges();
    },
    onError: (code) => {
      if (code === "INSUFFICIENT_FUNDS") refreshLookup();
      if (code === "CATALOG_CHANGED") void refreshCatalog(true);
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
        amountCents: calculateCartTotalCents(catalogItems, quantities),
      });
    },
    [buyer, buyerName, catalogItems, submit],
  );

  const canCharge =
    buyer !== null && sufficiency.status === "ready" && online && !catalogConfirmationRequired;
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

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => void refreshCatalog()}
          disabled={catalogRefreshing || busy || catalogConfirmationAvailable}
          className="self-start"
        >
          {catalogRefreshing ? "Refreshing catalog…" : "Refresh catalog"}
        </Button>
        {catalogError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {catalogError}
          </p>
        )}
      </div>

      {catalogWasRefreshed && catalogChanges.length === 0 && !catalogConfirmationRequired && (
        <p role="status" className="text-sm font-medium text-muted">
          Catalog is up to date.
        </p>
      )}

      <CatalogChangeNotice
        changes={catalogChanges}
        confirmationRequired={catalogConfirmationRequired}
        confirmationAvailable={catalogConfirmationAvailable}
        onConfirm={() => {
          setCatalogConfirmationRequired(false);
          setCatalogConfirmationAvailable(false);
          clearCatalogChanges();
        }}
      />

      <PosCart
        items={catalogItems}
        quantities={cartQuantities}
        onQuantitiesChange={setCartQuantities}
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
