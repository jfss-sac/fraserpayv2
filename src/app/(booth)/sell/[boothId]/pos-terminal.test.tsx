import { act, render as testingRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { BoothItem } from "@/lib/shared/types";
import { writePendingCharge } from "@/lib/ui/pending-charge";
import { ToastProvider } from "@/lib/ui/toast";
import { BuyerPanel, LAST_CHARGE_TICK_MS, PosTerminal, formatAge } from "./pos-terminal";

const CODE_ADA = `fp1-${"A".repeat(26)}`;
const CODE_BOB = `fp1-${"B".repeat(26)}`;

function render(ui: React.ReactNode) {
  return testingRender(ui, { wrapper: ToastProvider });
}

async function identifyByCode(code: string) {
  await userEvent.type(screen.getByLabelText("Payment code"), code);
  await userEvent.click(screen.getByRole("button", { name: "Look up buyer" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

test("prompts to confirm the buyer's name once known", () => {
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada Lovelace",
        balanceCents: 800,
        sufficient: true,
        lastPurchase: null,
      }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByText("Is this Ada Lovelace?")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Funds available");
});

test("shows the insufficient-funds indicator", () => {
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        balanceCents: 800,
        sufficient: false,
        lastPurchase: null,
      }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Not enough funds");
});

test("shows the buyer's balance alongside the sufficiency verdict", () => {
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        balanceCents: 1250,
        sufficient: false,
        lastPurchase: null,
      }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByText("Balance $12.50")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Not enough funds");
});

test("offers a retry on a transient lookup failure but not a settled one", async () => {
  const onRefresh = vi.fn();
  const { rerender } = render(
    <BuyerPanel
      state={{ status: "error", code: "RATE_LIMITED", retryable: true }}
      onClear={() => {}}
      onRefresh={onRefresh}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(onRefresh).toHaveBeenCalledOnce();

  rerender(
    <BuyerPanel
      state={{ status: "error", code: "NOT_FOUND", retryable: false }}
      onClear={() => {}}
      onRefresh={onRefresh}
    />,
  );
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("shows a checking indicator with a live region", () => {
  render(
    <BuyerPanel
      state={{ status: "checking", name: "Ada" }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(status).toHaveTextContent("Checking funds…");
});

test("always shows the student-card caution so the operator confirms the person", () => {
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        balanceCents: 800,
        sufficient: true,
        lastPurchase: null,
      }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByText("Ask for their student card to confirm.")).toBeInTheDocument();
});

test("maps error codes to operator-facing messages", () => {
  render(
    <BuyerPanel
      state={{ status: "error", code: "SUSPENDED", retryable: false }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("suspended");
});

test("lets the operator clear the buyer to scan again", async () => {
  const onClear = vi.fn();
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        balanceCents: 800,
        sufficient: true,
        lastPurchase: null,
      }}
      onClear={onClear}
      onRefresh={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Not them — scan again" }));
  expect(onClear).toHaveBeenCalledOnce();
});

test("offers a balance refresh once the buyer is known, but not while checking", async () => {
  const onRefresh = vi.fn();
  const { rerender } = render(
    <BuyerPanel
      state={{ status: "checking", name: "Ada" }}
      onClear={() => {}}
      onRefresh={onRefresh}
    />,
  );
  expect(screen.queryByRole("button", { name: "Refresh balance" })).not.toBeInTheDocument();

  rerender(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        balanceCents: 800,
        sufficient: false,
        lastPurchase: null,
      }}
      onClear={() => {}}
      onRefresh={onRefresh}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Refresh balance" }));
  expect(onRefresh).toHaveBeenCalledOnce();
});

test("surfaces a purchase this booth already rang for the buyer", () => {
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        balanceCents: 800,
        sufficient: true,
        lastPurchase: { amountCents: 450, ageMs: 8000, observedAt: Date.now() },
      }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.getByText("Already charged $4.50 here — 8s ago")).toBeInTheDocument();
});

test("says nothing about earlier purchases when there are none", () => {
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        balanceCents: 800,
        sufficient: true,
        lastPurchase: null,
      }}
      onClear={() => {}}
      onRefresh={() => {}}
    />,
  );
  expect(screen.queryByText(/Already charged/)).not.toBeInTheDocument();
});

test("reads the age off a badly skewed tablet clock and still counts up correctly", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2031-04-01T00:00:00Z"));
  try {
    render(
      <BuyerPanel
        state={{
          status: "ready",
          name: "Ada",
          balanceCents: 800,
          sufficient: true,
          lastPurchase: { amountCents: 450, ageMs: 8_000, observedAt: Date.now() },
        }}
        onClear={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByText("Already charged $4.50 here — 8s ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(LAST_CHARGE_TICK_MS * 2);
    });
    expect(screen.getByText("Already charged $4.50 here — 18s ago")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("resolving a recovered charge also resets the buyer and cart", async () => {
  const BOOTH_ITEMS: BoothItem[] = [{ id: "taco", name: "Taco", priceCents: 300, isCustom: false }];
  writePendingCharge(
    { actorUid: "op-1", boothId: "b1" },
    {
      key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
      sessionId: "crashed-session",
      buyer: { paymentCode: CODE_ADA },
      buyerName: "Ada",
      items: [{ itemId: "taco", qty: 1 }],
      amountCents: 300,
      startedAt: Date.now(),
    },
  );
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/api/booth/lookup")) {
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ name: "Ada", balanceCents: 100_000, lastPurchase: null }),
      } as Response;
    }
    return {
      ok: true,
      headers: new Headers(),
      json: async () => ({ entryId: "e1", amountCents: 300 }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<PosTerminal boothId="b1" actorUid="op-1" items={BOOTH_ITEMS} />);
  expect(screen.getByText("Did this charge go through?")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  await identifyByCode(CODE_ADA);
  await screen.findByText("Is this Ada?");

  await userEvent.click(screen.getByRole("button", { name: "Retry charge" }));
  await screen.findByText(/Unfinished charge resolved/);

  expect(screen.queryByText("Is this Ada?")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Taco quantity")).toHaveTextContent("0");
});

test("resolving a recovered charge keeps a different customer's in-progress sale intact", async () => {
  const BOOTH_ITEMS: BoothItem[] = [{ id: "taco", name: "Taco", priceCents: 300, isCustom: false }];
  writePendingCharge(
    { actorUid: "op-1", boothId: "b1" },
    {
      key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
      sessionId: "crashed-session",
      buyer: { paymentCode: CODE_ADA },
      buyerName: "Ada",
      items: [{ itemId: "taco", qty: 1 }],
      amountCents: 300,
      startedAt: Date.now(),
    },
  );
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/api/booth/lookup")) {
      const body = JSON.parse(String(init?.body)) as { buyer: { paymentCode?: string } };
      const name = body.buyer.paymentCode === CODE_BOB ? "Bob" : "Ada";
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ name, balanceCents: 100_000, lastPurchase: null }),
      } as Response;
    }
    return {
      ok: true,
      headers: new Headers(),
      json: async () => ({ entryId: "e1", amountCents: 300 }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<PosTerminal boothId="b1" actorUid="op-1" items={BOOTH_ITEMS} />);
  expect(screen.getByText("Did this charge go through?")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  await identifyByCode(CODE_BOB);
  await screen.findByText("Is this Bob?");

  await userEvent.click(screen.getByRole("button", { name: "Retry charge" }));
  await screen.findByText(/Unfinished charge resolved/);

  expect(screen.getByText("Is this Bob?")).toBeInTheDocument();
  expect(screen.getByLabelText("Taco quantity")).toHaveTextContent("1");
});

test("a recovered charge identified another way still resets — it could be the same student", async () => {
  const BOOTH_ITEMS: BoothItem[] = [{ id: "taco", name: "Taco", priceCents: 300, isCustom: false }];
  writePendingCharge(
    { actorUid: "op-1", boothId: "b1" },
    {
      key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
      sessionId: "crashed-session",
      buyer: { studentNumber: "123456" },
      buyerName: "Ada",
      items: [{ itemId: "taco", qty: 1 }],
      amountCents: 300,
      startedAt: Date.now(),
    },
  );
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.includes("/api/booth/lookup")) {
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ name: "Bob", balanceCents: 100_000, lastPurchase: null }),
      } as Response;
    }
    return {
      ok: true,
      headers: new Headers(),
      json: async () => ({ entryId: "e1", amountCents: 300 }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<PosTerminal boothId="b1" actorUid="op-1" items={BOOTH_ITEMS} />);

  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  await identifyByCode(CODE_BOB);
  await screen.findByText("Is this Bob?");

  await userEvent.click(screen.getByRole("button", { name: "Retry charge" }));
  await screen.findByText(/Unfinished charge resolved/);

  expect(screen.queryByText("Is this Bob?")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Taco quantity")).toHaveTextContent("0");
});

test("withholds the recovery retry while offline", () => {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  const BOOTH_ITEMS: BoothItem[] = [{ id: "taco", name: "Taco", priceCents: 300, isCustom: false }];
  writePendingCharge(
    { actorUid: "op-1", boothId: "b1" },
    {
      key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
      sessionId: "crashed-session",
      buyer: { studentNumber: "123456" },
      buyerName: "Ada",
      items: [{ itemId: "taco", qty: 1 }],
      amountCents: 300,
      startedAt: Date.now(),
    },
  );

  render(<PosTerminal boothId="b1" actorUid="op-1" items={BOOTH_ITEMS} />);
  expect(screen.getByRole("button", { name: "Retry charge" })).toBeDisabled();
});

test("re-reads the balance after a charge is rejected for insufficient funds", async () => {
  const BOOTH_ITEMS: BoothItem[] = [{ id: "taco", name: "Taco", priceCents: 300, isCustom: false }];
  let lookups = 0;
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/api/booth/lookup")) {
      lookups += 1;
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({
          name: "Ada",
          balanceCents: lookups === 1 ? 300 : 5000,
          lastPurchase: null,
        }),
      } as Response;
    }
    return {
      ok: false,
      headers: new Headers(),
      json: async () => ({ error: { code: "INSUFFICIENT_FUNDS" } }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<PosTerminal boothId="b1" actorUid="op-1" items={BOOTH_ITEMS} />);
  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  await identifyByCode(CODE_ADA);
  await screen.findByText("Balance $3.00");

  await userEvent.click(screen.getByRole("button", { name: /Charge/ }));
  await screen.findByText("Balance can't cover this cart.");

  expect(await screen.findByText("Balance $50.00")).toBeInTheDocument();
  expect(lookups).toBe(2);
});

test("formatAge reads in seconds under a minute and minutes above it", () => {
  expect(formatAge(8_000)).toBe("8s ago");
  expect(formatAge(59_400)).toBe("59s ago");
  expect(formatAge(90_000)).toBe("1m ago");
  expect(formatAge(-5)).toBe("0s ago");
});
