"use client";

import { useCallback, useRef, useState } from "react";
import type { BoothItem } from "@/lib/shared/types";

export const CATALOG_REFRESH_ERROR = "Couldn't refresh the catalog. Try again.";

export type CatalogChange =
  | {
      type: "price";
      itemId: string;
      name: string;
      previousPriceCents: number;
      priceCents: number;
    }
  | {
      type: "archived";
      itemId: string;
      name: string;
      previousPriceCents: number;
    }
  | {
      type: "added";
      itemId: string;
      name: string;
      priceCents: number;
    };

export interface CatalogRefreshResult {
  items: BoothItem[];
  changes: CatalogChange[];
}

function isBoothItem(value: unknown): value is BoothItem {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.priceCents === "number" &&
    Number.isInteger(item.priceCents) &&
    typeof item.isCustom === "boolean"
  );
}

function readCatalogItems(value: unknown): BoothItem[] {
  if (value === null || typeof value !== "object") throw new Error("Invalid catalog response");
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items) || !items.every(isBoothItem)) {
    throw new Error("Invalid catalog response");
  }
  return items;
}

export function diffCatalog(previous: BoothItem[], next: BoothItem[]): CatalogChange[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));
  const changes: CatalogChange[] = [];

  for (const item of previous) {
    const refreshed = nextById.get(item.id);
    if (!refreshed) {
      changes.push({
        type: "archived",
        itemId: item.id,
        name: item.name,
        previousPriceCents: item.priceCents,
      });
    } else if (refreshed.priceCents !== item.priceCents) {
      changes.push({
        type: "price",
        itemId: item.id,
        name: refreshed.name,
        previousPriceCents: item.priceCents,
        priceCents: refreshed.priceCents,
      });
    }
  }

  for (const item of next) {
    if (!previousById.has(item.id)) {
      changes.push({
        type: "added",
        itemId: item.id,
        name: item.name,
        priceCents: item.priceCents,
      });
    }
  }

  return changes;
}

export function useCatalog({
  boothId,
  initialItems,
}: {
  boothId: string;
  initialItems: BoothItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [changes, setChanges] = useState<CatalogChange[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentItems = useRef(initialItems);
  const refreshInFlight = useRef<Promise<CatalogRefreshResult | null> | null>(null);

  const refresh = useCallback((): Promise<CatalogRefreshResult | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;

    setIsRefreshing(true);
    setError(null);
    const request = fetch(`/api/booth/${encodeURIComponent(boothId)}/catalog`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Catalog request failed");
        return readCatalogItems(await response.json());
      })
      .then((nextItems) => {
        const nextChanges = diffCatalog(currentItems.current, nextItems);
        currentItems.current = nextItems;
        setItems(nextItems);
        setChanges(nextChanges);
        return { items: nextItems, changes: nextChanges };
      })
      .catch(() => {
        setError(CATALOG_REFRESH_ERROR);
        return null;
      })
      .finally(() => {
        setIsRefreshing(false);
        refreshInFlight.current = null;
      });

    refreshInFlight.current = request;
    return request;
  }, [boothId]);

  const clearChanges = useCallback(() => setChanges([]), []);

  return { items, changes, isRefreshing, error, refresh, clearChanges };
}
