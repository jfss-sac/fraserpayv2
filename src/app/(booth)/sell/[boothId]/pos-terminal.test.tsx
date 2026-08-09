import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { BoothItem } from "@/lib/shared/types";
import { writePendingCharge } from "@/lib/ui/pending-charge";
import { BuyerPanel, LAST_CHARGE_TICK_MS, PosTerminal, formatAge } from "./pos-terminal";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

test("prompts to confirm the buyer's name once known", () => {
  render(
    <BuyerPanel
      state={{ status: "ready", name: "Ada Lovelace", sufficient: true, lastPurchase: null }}
      typed={false}
      onClear={() => {}}
    />,
  );
  expect(screen.getByText("Is this Ada Lovelace?")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Funds available");
});

test("shows the insufficient-funds indicator", () => {
  render(
    <BuyerPanel
      state={{ status: "ready", name: "Ada", sufficient: false, lastPurchase: null }}
      typed={false}
      onClear={() => {}}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Not enough funds");
});

test("shows a checking indicator with a live region", () => {
  render(
    <BuyerPanel state={{ status: "checking", name: "Ada" }} typed={false} onClear={() => {}} />,
  );
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(status).toHaveTextContent("Checking funds…");
});

test("adds the student-card caution on the typed-number path", () => {
  render(
    <BuyerPanel
      state={{ status: "ready", name: "Ada", sufficient: true, lastPurchase: null }}
      typed
      onClear={() => {}}
    />,
  );
  expect(screen.getByText("Ask for their student card to confirm.")).toBeInTheDocument();
});

test("maps error codes to operator-facing messages", () => {
  render(
    <BuyerPanel state={{ status: "error", code: "SUSPENDED" }} typed={false} onClear={() => {}} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("suspended");
});

test("lets the operator clear the buyer to scan again", async () => {
  const onClear = vi.fn();
  render(
    <BuyerPanel
      state={{ status: "ready", name: "Ada", sufficient: true, lastPurchase: null }}
      typed={false}
      onClear={onClear}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Not them — scan again" }));
  expect(onClear).toHaveBeenCalledOnce();
});

test("surfaces a purchase this booth already rang for the buyer", () => {
  render(
    <BuyerPanel
      state={{
        status: "ready",
        name: "Ada",
        sufficient: true,
        lastPurchase: { amountCents: 450, ageMs: 8000, observedAt: Date.now() },
      }}
      typed={false}
      onClear={() => {}}
    />,
  );
  expect(screen.getByText("Already charged $4.50 here — 8s ago")).toBeInTheDocument();
});

test("says nothing about earlier purchases when there are none", () => {
  render(
    <BuyerPanel
      state={{ status: "ready", name: "Ada", sufficient: true, lastPurchase: null }}
      typed={false}
      onClear={() => {}}
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
          sufficient: true,
          lastPurchase: { amountCents: 450, ageMs: 8_000, observedAt: Date.now() },
        }}
        typed={false}
        onClear={() => {}}
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
        json: async () => ({ name: "Ada", sufficient: true, lastPurchase: null }),
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
  await userEvent.type(screen.getByLabelText("Student number"), "123456");
  await userEvent.click(screen.getByRole("button", { name: "Look up student" }));
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
      buyer: { studentNumber: "123456" },
      buyerName: "Ada",
      items: [{ itemId: "taco", qty: 1 }],
      amountCents: 300,
      startedAt: Date.now(),
    },
  );
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/api/booth/lookup")) {
      const body = JSON.parse(String(init?.body)) as { buyer: { studentNumber?: string } };
      const name = body.buyer.studentNumber === "654321" ? "Bob" : "Ada";
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ name, sufficient: true, lastPurchase: null }),
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
  await userEvent.type(screen.getByLabelText("Student number"), "654321");
  await userEvent.click(screen.getByRole("button", { name: "Look up student" }));
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
      buyer: { paymentCode: "PC-ADA-1" },
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
        json: async () => ({ name: "Bob", sufficient: true, lastPurchase: null }),
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
  await userEvent.type(screen.getByLabelText("Student number"), "654321");
  await userEvent.click(screen.getByRole("button", { name: "Look up student" }));
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

test("formatAge reads in seconds under a minute and minutes above it", () => {
  expect(formatAge(8_000)).toBe("8s ago");
  expect(formatAge(59_400)).toBe("59s ago");
  expect(formatAge(90_000)).toBe("1m ago");
  expect(formatAge(-5)).toBe("0s ago");
});
