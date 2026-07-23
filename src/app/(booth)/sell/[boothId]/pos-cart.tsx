"use client";

import { useState } from "react";
import { formatCents } from "@/lib/shared/money";
import type { BoothItem } from "@/lib/shared/types";
import { Button } from "@/lib/ui/vendor/button";
import { Card, CardContent } from "@/lib/ui/vendor/card";

export type CartQuantities = Record<string, number>;

export function cartTotalCents(items: BoothItem[], quantities: CartQuantities): number {
  return items.reduce((sum, item) => sum + item.priceCents * (quantities[item.id] ?? 0), 0);
}

export function cartItemCount(quantities: CartQuantities): number {
  return Object.values(quantities).reduce((sum, qty) => sum + qty, 0);
}

export function PosCart({
  items,
  onCharge,
}: {
  items: BoothItem[];
  onCharge?: (quantities: CartQuantities) => void;
}) {
  const [quantities, setQuantities] = useState<CartQuantities>({});

  const total = cartTotalCents(items, quantities);
  const count = cartItemCount(quantities);

  function step(id: string, delta: number) {
    setQuantities((current) => {
      const next = Math.max(0, (current[id] ?? 0) + delta);
      return { ...current, [id]: next };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="grid grid-cols-2 gap-3">
        {items.map((item) => {
          const qty = quantities[item.id] ?? 0;
          return (
            <li key={item.id}>
              <Card>
                <CardContent>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-foreground">{item.name}</span>
                    <span className="text-sm text-muted">
                      {item.isCustom
                        ? `${formatCents(item.priceCents)} × N`
                        : formatCents(item.priceCents)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => step(item.id, -1)}
                      disabled={qty === 0}
                      aria-label={`Remove one ${item.name}`}
                    >
                      −
                    </Button>
                    <span
                      aria-label={`${item.name} quantity`}
                      aria-live="polite"
                      className="min-w-8 text-center text-lg font-semibold text-foreground"
                    >
                      {qty}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => step(item.id, 1)}
                      aria-label={`Add ${item.name}`}
                    >
                      +
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <span className="flex flex-col">
          <span className="text-sm text-muted">
            {count} {count === 1 ? "item" : "items"}
          </span>
          <span aria-label="Cart total" className="text-2xl font-bold text-foreground">
            {formatCents(total)}
          </span>
        </span>
        <Button
          type="button"
          size="lg"
          onClick={() => onCharge?.(quantities)}
          disabled={count === 0 || !onCharge}
        >
          Charge
        </Button>
      </div>
    </div>
  );
}
