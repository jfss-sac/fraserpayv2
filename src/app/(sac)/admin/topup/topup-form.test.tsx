import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SacLookupResult, TopUpResult } from "@/lib/shared/types";
import { TopUpForm, parseAmountCents } from "./topup-form";

const STUDENT: SacLookupResult = { name: "Ben Carter", balanceCents: 2000, points: 100 };

interface FetchStub {
  lookup?: SacLookupResult;
  lookupError?: string;
  topup?: TopUpResult;
  topupError?: string;
  topupErrorMessage?: string;
}

function stubFetch(opts: FetchStub) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/sac/lookup") {
      return opts.lookupError
        ? ({ ok: false, json: async () => ({ error: { code: opts.lookupError } }) } as Response)
        : ({ ok: true, json: async () => opts.lookup } as Response);
    }
    if (url === "/api/sac/topup") {
      return opts.topupError
        ? ({
            ok: false,
            json: async () => ({
              error: { code: opts.topupError, message: opts.topupErrorMessage },
            }),
          } as Response)
        : ({ ok: true, json: async () => opts.topup } as Response);
    }
    throw new Error(`unexpected fetch to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function gotoAmountStage(isExec: boolean, student: SacLookupResult = STUDENT): Promise<void> {
  render(<TopUpForm isExec={isExec} />);
  await userEvent.type(screen.getByLabelText("Student number"), "843902");
  await userEvent.click(screen.getByRole("button", { name: "Look up student" }));
  await userEvent.click(await screen.findByRole("button", { name: "Yes, top up" }));
  expect(screen.getByText(`Topping up ${student.name}`)).toBeInTheDocument();
}

async function setAmount(value: string): Promise<void> {
  const input = screen.getByLabelText("Top-up amount in dollars");
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

afterEach(() => {
  vi.restoreAllMocks();
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
    render(<TopUpForm isExec={false} />);

    await userEvent.type(screen.getByLabelText("Student number"), "843902");
    await userEvent.click(screen.getByRole("button", { name: "Look up student" }));

    expect(await screen.findByText("Is this Ben Carter?")).toBeInTheDocument();
    expect(screen.getByText("Ask for their student card to confirm.")).toBeInTheDocument();
  });

  test("a failed lookup toasts and returns to the scanner", async () => {
    stubFetch({ lookupError: "NOT_FOUND" });
    render(<TopUpForm isExec={false} />);

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

  test("a FORBIDDEN with no server reason falls back to the self-dealing copy", async () => {
    stubFetch({ lookup: STUDENT, topupError: "FORBIDDEN" });
    await gotoAmountStage(false);
    await userEvent.click(screen.getByRole("button", { name: "$10.00" }));

    await userEvent.click(screen.getByRole("button", { name: "Top up $10.00" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You can't top up your own account");
  });
});
