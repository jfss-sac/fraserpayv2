import { render as testingRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SacLookupResult, TopUpResult } from "@/lib/shared/types";
import { writePendingTopUp } from "@/lib/ui/pending-topup";
import { ToastProvider } from "@/lib/ui/toast";
import { TopUpForm, parseAmountCents } from "./topup-form";

const STUDENT: SacLookupResult = { name: "Ben Carter", balanceCents: 2000, points: 100 };
const ACTOR = "sac-1";

function render(ui: React.ReactNode) {
  return testingRender(ui, { wrapper: ToastProvider });
}

interface FetchStub {
  lookup?: SacLookupResult;
  lookupError?: string;
  topup?: TopUpResult;
  topupError?: string;
  topupErrorMessage?: string;
}

function okResponse(result: unknown, opts: { replayed?: boolean } = {}): Response {
  const headers = new Headers(opts.replayed ? { "idempotent-replay": "true" } : {});
  return { ok: true, headers, json: async () => result } as Response;
}

function errorResponse(body: unknown): Response {
  return { ok: false, headers: new Headers(), json: async () => body } as Response;
}

function stubFetch(opts: FetchStub) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/sac/lookup") {
      return opts.lookupError
        ? errorResponse({ error: { code: opts.lookupError } })
        : okResponse(opts.lookup);
    }
    if (url === "/api/sac/topup") {
      return opts.topupError
        ? errorResponse({ error: { code: opts.topupError, message: opts.topupErrorMessage } })
        : okResponse(opts.topup);
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function identifyAndConfirm(student: SacLookupResult = STUDENT): Promise<void> {
  await userEvent.type(screen.getByLabelText("Student number"), "843902");
  await userEvent.click(screen.getByRole("button", { name: "Look up student" }));
  await userEvent.click(await screen.findByRole("button", { name: "Yes, top up" }));
  expect(screen.getByText(`Topping up ${student.name}`)).toBeInTheDocument();
}

async function gotoAmountStage(isExec: boolean, student: SacLookupResult = STUDENT): Promise<void> {
  render(<TopUpForm isExec={isExec} actorUid={ACTOR} />);
  await identifyAndConfirm(student);
}

function topUpKeys(fetchMock: { mock: { calls: unknown[][] } }): Set<string | null> {
  return new Set(
    fetchMock.mock.calls
      .filter((call) => call[0] === "/api/sac/topup")
      .map((call) => new Headers((call[1] as RequestInit).headers).get("idempotency-key")),
  );
}

async function setAmount(value: string): Promise<void> {
  const input = screen.getByLabelText("Top-up amount in dollars");
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("parseAmountCents", () => {
  test("accepts 50¢ multiples in dollars", () => {
    expect(parseAmountCents("10")).toBe(1000);
    expect(parseAmountCents("10.50")).toBe(1050);
    expect(parseAmountCents("0.50")).toBe(50);
  });

  test("rejects non-50¢ increments, zero, and junk", () => {
    expect(parseAmountCents("10.34")).toBeNull();
    expect(parseAmountCents("0")).toBeNull();
    expect(parseAmountCents("")).toBeNull();
    expect(parseAmountCents("abc")).toBeNull();
  });
});

describe("identify → confirm", () => {
  test("looks up the student and asks to confirm the name", async () => {
    stubFetch({ lookup: STUDENT });
    render(<TopUpForm isExec={false} actorUid={ACTOR} />);

    await userEvent.type(screen.getByLabelText("Student number"), "843902");
    await userEvent.click(screen.getByRole("button", { name: "Look up student" }));

    expect(await screen.findByText("Is this Ben Carter?")).toBeInTheDocument();
    expect(screen.getByText("Ask for their student card to confirm.")).toBeInTheDocument();
  });

  test("a failed lookup toasts and returns to the scanner", async () => {
    stubFetch({ lookupError: "NOT_FOUND" });
    render(<TopUpForm isExec={false} actorUid={ACTOR} />);

    await userEvent.type(screen.getByLabelText("Student number"), "843902");
    await userEvent.click(screen.getByRole("button", { name: "Look up student" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No student matches that code or number.",
    );
    expect(screen.getByRole("button", { name: "Look up student" })).toBeInTheDocument();
  });
});

describe("re-confirm dialog (FR-10a)", () => {
  test("does not re-confirm below $50", async () => {
    const fetchMock = stubFetch({
      lookup: STUDENT,
      topup: { entryId: "e1", amountCents: 4950, balanceAfterCents: 6950, points: 347.5 },
    });
    await gotoAmountStage(false);
    await setAmount("49.50");

    await userEvent.click(screen.getByRole("button", { name: "Top up $49.50" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/sac/topup")).toBe(true);
  });

  test("re-confirms at exactly $50", async () => {
    const fetchMock = stubFetch({
      lookup: STUDENT,
      topup: { entryId: "e1", amountCents: 5000, balanceAfterCents: 7000, points: 350 },
    });
    await gotoAmountStage(false);
    await setAmount("50");

    await userEvent.click(screen.getByRole("button", { name: "Top up $50.00" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/fifty dollars/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/sac/topup")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm $50.00" }));
    expect(await screen.findByText("Topped up Ben Carter")).toBeInTheDocument();
  });

  test("re-confirms just above $50 with the amount spelled out", async () => {
    const fetchMock = stubFetch({
      lookup: STUDENT,
      topup: { entryId: "e1", amountCents: 5050, balanceAfterCents: 7050, points: 352.5 },
    });
    await gotoAmountStage(false);
    await setAmount("50.50");

    await userEvent.click(screen.getByRole("button", { name: "Top up $50.50" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/fifty dollars and fifty cents/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/sac/topup")).toBe(false);

    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm $50.50" }));
    expect(await screen.findByText("Topped up Ben Carter")).toBeInTheDocument();
  });
});

describe("exec-only override (FR-10a, I7)", () => {
  test("a member sees no override field over the cap, only an inline warning", async () => {
    stubFetch({ lookup: STUDENT });
    await gotoAmountStage(false);
    await setAmount("100.50");

    expect(screen.queryByLabelText("Reason for override")).not.toBeInTheDocument();
    expect(screen.getByText(/only an exec can override/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Top up $100.50" })).toBeDisabled();
  });

  test("a member cannot submit an amount that would exceed the balance cap", async () => {
    const student = { ...STUDENT, balanceCents: 15_000 };
    stubFetch({ lookup: student });
    await gotoAmountStage(false, student);
    await setAmount("50.50");

    expect(screen.getByText(/only an exec can override/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Top up $50.50" })).toBeDisabled();
  });

  test("an exec gets a required override field over the cap", async () => {
    stubFetch({ lookup: STUDENT });
    await gotoAmountStage(true);
    await setAmount("100.50");

    const reason = screen.getByLabelText("Reason for override");
    expect(reason).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Top up $100.50" })).toBeDisabled();

    await userEvent.type(reason, "class trip prepayment");
    expect(screen.getByRole("button", { name: "Top up $100.50" })).toBeEnabled();
  });

  test("within-cap amounts never show the override field for an exec", async () => {
    stubFetch({ lookup: STUDENT });
    await gotoAmountStage(true);
    await setAmount("20");

    expect(screen.queryByLabelText("Reason for override")).not.toBeInTheDocument();
  });
});

describe("submit outcomes", () => {
  test("happy path shows the new balance and points granted", async () => {
    stubFetch({
      lookup: STUDENT,
      topup: { entryId: "e1", amountCents: 1000, balanceAfterCents: 3000, points: 150 },
    });
    await gotoAmountStage(false);
    await userEvent.click(screen.getByRole("button", { name: "$10.00" }));

    await userEvent.click(screen.getByRole("button", { name: "Top up $10.00" }));

    expect(await screen.findByText("Topped up Ben Carter")).toBeInTheDocument();
    expect(screen.getByText("$30.00")).toBeInTheDocument();
    expect(screen.getByText("+50 (150 total)")).toBeInTheDocument();
  });

  test("a cap rejection toasts without leaving the form", async () => {
    stubFetch({ lookup: STUDENT, topupError: "CAP_EXCEEDED" });
    await gotoAmountStage(false);
    await userEvent.click(screen.getByRole("button", { name: "$10.00" }));

    await userEvent.click(screen.getByRole("button", { name: "Top up $10.00" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Over the $100 top-up / $200 balance cap",
    );
    expect(screen.getByRole("button", { name: "Top up $10.00" })).toBeInTheDocument();
  });

  test("a FORBIDDEN that is not self-dealing toasts the server's reason", async () => {
    stubFetch({
      lookup: STUDENT,
      topupError: "FORBIDDEN",
      topupErrorMessage: "You do not have permission to do that.",
    });
    await gotoAmountStage(false);
    await userEvent.click(screen.getByRole("button", { name: "$10.00" }));

    await userEvent.click(screen.getByRole("button", { name: "Top up $10.00" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You do not have permission to do that.");
    expect(alert).not.toHaveTextContent("your own account");
  });

  test("Start over then re-ringing the same top-up reuses the key and reports the replay", async () => {
    let topUpCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/sac/lookup") return okResponse(STUDENT);
      if (url !== "/api/sac/topup") throw new Error(`unexpected fetch to ${url}`);
      topUpCalls += 1;
      if (topUpCalls <= 3) throw new TypeError("network");
      return okResponse(
        { entryId: "e1", amountCents: 1000, balanceAfterCents: 3000, points: 150 },
        { replayed: true },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await gotoAmountStage(false);
    await userEvent.click(screen.getByRole("button", { name: "$10.00" }));
    await userEvent.click(screen.getByRole("button", { name: "Top up $10.00" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server");

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    await identifyAndConfirm();
    await userEvent.click(screen.getByRole("button", { name: "$10.00" }));
    await userEvent.click(screen.getByRole("button", { name: "Top up $10.00" }));

    expect(
      await screen.findByText("Already processed — no new top-up for Ben Carter"),
    ).toBeInTheDocument();
    expect(screen.getByText(/don't take payment for it a second time/i)).toBeInTheDocument();
    expect(topUpKeys(fetchMock).size).toBe(1);
  });

  test("a top-up stranded by a reload comes back as a card that retries its own key", async () => {
    const stranded = {
      key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
      sessionId: "an-earlier-page-load",
      buyer: { studentNumber: "843902" },
      studentName: "Ben Carter",
      amountCents: 1000,
      method: "cash" as const,
      startedAt: Date.now(),
    };
    writePendingTopUp(ACTOR, stranded);
    const fetchMock = stubFetch({
      lookup: STUDENT,
      topup: { entryId: "e1", amountCents: 1000, balanceAfterCents: 3000, points: 150 },
    });
    render(<TopUpForm isExec={false} actorUid={ACTOR} />);

    expect(screen.getByRole("alert", { name: "Unfinished top-up" })).toHaveTextContent(
      "$10.00 for Ben Carter",
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry top-up" }));

    expect(await screen.findByText(/Unfinished top-up resolved/)).toBeInTheDocument();
    expect(topUpKeys(fetchMock)).toEqual(new Set([stranded.key]));
    expect(screen.queryByRole("alert", { name: "Unfinished top-up" })).not.toBeInTheDocument();
  });

  test("dismissing a stranded top-up clears the card without touching the ledger", async () => {
    writePendingTopUp(ACTOR, {
      key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
      sessionId: "an-earlier-page-load",
      buyer: { studentNumber: "843902" },
      studentName: "Ben Carter",
      amountCents: 1000,
      method: "cash",
      startedAt: Date.now(),
    });
    const fetchMock = stubFetch({ lookup: STUDENT });
    render(<TopUpForm isExec={false} actorUid={ACTOR} />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert", { name: "Unfinished top-up" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/sac/topup")).toBe(false);
  });

  test("a FORBIDDEN with no server reason falls back to the self-dealing copy", async () => {
    stubFetch({ lookup: STUDENT, topupError: "FORBIDDEN" });
    await gotoAmountStage(false);
    await userEvent.click(screen.getByRole("button", { name: "$10.00" }));

    await userEvent.click(screen.getByRole("button", { name: "Top up $10.00" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You can't top up your own account");
  });
});
