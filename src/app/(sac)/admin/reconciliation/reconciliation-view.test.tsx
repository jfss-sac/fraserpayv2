import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ReconciliationDTO } from "@/lib/shared/types";
import { ReconciliationView } from "./reconciliation-view";

const DAY: ReconciliationDTO = {
  date: "2024-01-15",
  members: [
    {
      actorUid: "me",
      actorName: "Ava Member",
      cashCents: 1500,
      cashCount: 2,
      cardCents: 2000,
      cardCount: 1,
      topups: [
        {
          id: "t1",
          createdAt: "2024-01-15T15:00:00.000Z",
          amountCents: 1000,
          method: "cash",
          studentName: "Sam Student",
          studentNumber: "700001",
          tags: [],
        },
      ],
      corrections: [
        {
          id: "c1",
          createdAt: "2024-01-15T16:00:00.000Z",
          amountCents: 500,
          direction: "debit",
          studentName: "Sam Student",
          studentNumber: "700001",
          reason: "duplicate top-up",
          originalEntryId: "t9",
          pointsDelta: -25,
        },
      ],
    },
  ],
  totals: { cashCents: 1500, cardCents: 2000, topupCount: 3, correctionCount: 1 },
};

const EMPTY: ReconciliationDTO = {
  date: "2024-01-14",
  members: [],
  totals: { cashCents: 0, cardCents: 0, topupCount: 0, correctionCount: 0 },
};

const LATE_EVENING: ReconciliationDTO = {
  date: "2024-01-14",
  members: [
    {
      actorUid: "me",
      actorName: "Ava Member",
      cashCents: 1000,
      cashCount: 1,
      cardCents: 0,
      cardCount: 0,
      topups: [
        {
          id: "t2",
          createdAt: "2024-01-15T02:30:00.000Z",
          amountCents: 1000,
          method: "cash",
          studentName: "Sam Student",
          studentNumber: "700001",
          tags: [],
        },
      ],
      corrections: [],
    },
  ],
  totals: { cashCents: 1000, cardCents: 0, topupCount: 1, correctionCount: 0 },
};

function stubFetch(byDate: Record<string, ReconciliationDTO>) {
  const fetchMock = vi.fn(async (url: string) => {
    const date = new URL(url, "http://localhost").searchParams.get("date") ?? "";
    const dto = byDate[date];
    if (!dto)
      return { ok: false, json: async () => ({ error: { code: "VALIDATION" } }) } as Response;
    return { ok: true, json: async () => dto } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReconciliationView", () => {
  test("shows grand totals and a per-member cash/card breakdown for the initial day", async () => {
    stubFetch({ "2024-01-15": DAY });
    render(<ReconciliationView initialDate="2024-01-15" currentUid="me" />);

    expect(await screen.findByText("You recorded $15.00 cash / $20.00 card")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/api/sac/reconciliation/export?date=2024-01-15",
    );
  });

  test("drill-down reveals top-up entries and linked corrections", async () => {
    stubFetch({ "2024-01-15": DAY });
    render(<ReconciliationView initialDate="2024-01-15" currentUid="me" />);

    const toggle = await screen.findByRole("button", { name: /Ava Member/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    expect(screen.getByText("Corrections")).toBeInTheDocument();
    expect(screen.getByText("duplicate top-up")).toBeInTheDocument();
  });

  test("changing the date refetches for the new day", async () => {
    const fetchMock = stubFetch({ "2024-01-15": DAY, "2024-01-14": EMPTY });
    render(<ReconciliationView initialDate="2024-01-15" currentUid="me" />);
    await screen.findByText("You recorded $15.00 cash / $20.00 card");

    fireEvent.change(screen.getByLabelText("Day (America/Toronto)"), {
      target: { value: "2024-01-14" },
    });

    expect(await screen.findByText("No top-ups recorded on this day.")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes("date=2024-01-14"))).toBe(true),
    );
  });

  test("stamps top-up times in America/Toronto, not the viewer's timezone", async () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe("America/Toronto");
    stubFetch({ "2024-01-14": LATE_EVENING });
    render(<ReconciliationView initialDate="2024-01-14" currentUid="me" />);

    await userEvent.click(await screen.findByRole("button", { name: /Ava Member/ }));

    expect(screen.getByText("21:30 · cash")).toBeInTheDocument();
    expect(screen.queryByText("02:30 · cash")).toBeNull();
  });

  test("does not mark other members as You", async () => {
    stubFetch({ "2024-01-15": DAY });
    render(<ReconciliationView initialDate="2024-01-15" currentUid="someone-else" />);

    const card = (await screen.findByRole("button", { name: /Ava Member/ })).closest("li")!;
    expect(within(card).queryByText("You")).toBeNull();
    expect(
      within(card).getByText("Ava Member recorded $15.00 cash / $20.00 card"),
    ).toBeInTheDocument();
  });
});
