import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { BoothItem } from "@/lib/shared/types";
import { diffCatalog, useCatalog } from "./use-catalog";

const POUTINE: BoothItem = { id: "poutine", name: "Poutine", priceCents: 400, isCustom: false };
const DRINK: BoothItem = { id: "drink", name: "Drink", priceCents: 200, isCustom: false };
const NEW_ITEM: BoothItem = { id: "cookie", name: "Cookie", priceCents: 150, isCustom: false };

afterEach(() => vi.unstubAllGlobals());

test("diffCatalog reports reprices, archives, and additions in catalog order", () => {
  expect(diffCatalog([POUTINE, DRINK], [{ ...POUTINE, priceCents: 450 }, NEW_ITEM])).toEqual([
    {
      type: "price",
      itemId: "poutine",
      name: "Poutine",
      previousPriceCents: 400,
      priceCents: 450,
    },
    { type: "archived", itemId: "drink", name: "Drink", previousPriceCents: 200 },
    { type: "added", itemId: "cookie", name: "Cookie", priceCents: 150 },
  ]);
});

test("refresh replaces the catalog and exposes the changes", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "booth-1",
      name: "Lunch",
      description: "",
      status: "approved",
      items: [{ ...POUTINE, priceCents: 450 }, NEW_ITEM],
    }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCatalog({ boothId: "booth-1", initialItems: [POUTINE] }));
  let refreshed: Awaited<ReturnType<typeof result.current.refresh>> = null;
  await act(async () => {
    refreshed = await result.current.refresh();
  });

  expect(fetchMock).toHaveBeenCalledWith("/api/booth/booth-1/catalog", { cache: "no-store" });
  expect(refreshed).toEqual({
    items: [{ ...POUTINE, priceCents: 450 }, NEW_ITEM],
    changes: [
      {
        type: "price",
        itemId: "poutine",
        name: "Poutine",
        previousPriceCents: 400,
        priceCents: 450,
      },
      { type: "added", itemId: "cookie", name: "Cookie", priceCents: 150 },
    ],
  });
  expect(result.current.items).toEqual([{ ...POUTINE, priceCents: 450 }, NEW_ITEM]);
  expect(result.current.changes).toHaveLength(2);
  expect(result.current.isRefreshing).toBe(false);
});

test("coalesces concurrent refreshes into one catalog read", async () => {
  let resolve: ((value: Response) => void) | undefined;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((complete) => {
        resolve = complete;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useCatalog({ boothId: "booth-1", initialItems: [POUTINE] }));
  let first: ReturnType<typeof result.current.refresh>;
  let second: ReturnType<typeof result.current.refresh>;
  act(() => {
    first = result.current.refresh();
    second = result.current.refresh();
  });
  expect(first!).toBe(second!);
  expect(fetchMock).toHaveBeenCalledOnce();

  await act(async () => {
    resolve?.({
      ok: true,
      json: async () => ({ items: [POUTINE] }),
    } as Response);
    await first!;
  });
});
