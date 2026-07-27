import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { SacLedgerEntry } from "@/lib/shared/types";
import { RefundDialog } from "./refund-dialog";

const PURCHASE: SacLedgerEntry = {
  id: "purchase-1",
  type: "purchase",
  direction: "debit",
  amountCents: 600,
  balanceAfterCents: 400,
  createdAt: "2026-07-20T12:00:00.000Z",
  tags: [],
  actorName: "Ava Nguyen",
  boothName: "Pizza Palace",
  lineItems: [{ itemId: "slice", name: "Slice", qty: 2, unitPriceCents: 300 }],
};

describe("RefundDialog", () => {
  test("defaults to a full refund with no line items", async () => {
    const onSubmit = vi.fn();
    render(<RefundDialog entry={PURCHASE} busy={false} onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText("Reason"), "duplicate charge");
    await userEvent.click(screen.getByRole("button", { name: "Refund remaining" }));

    expect(onSubmit).toHaveBeenCalledWith({
      originalEntryId: "purchase-1",
      reason: "duplicate charge",
    });
  });

  test("per-item scope refunds the selected quantities", async () => {
    const onSubmit = vi.fn();
    render(<RefundDialog entry={PURCHASE} busy={false} onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Per item" }));
    await userEvent.click(screen.getByRole("button", { name: "Refund one fewer Slice" }));

    expect(screen.getByRole("button", { name: "Refund $3.00" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Reason"), "one slice was fine");
    await userEvent.click(screen.getByRole("button", { name: "Refund $3.00" }));

    expect(onSubmit).toHaveBeenCalledWith({
      originalEntryId: "purchase-1",
      reason: "one slice was fine",
      lineItems: [{ itemId: "slice", qty: 1 }],
    });
  });

  test("submit is disabled until a reason is present", async () => {
    render(<RefundDialog entry={PURCHASE} busy={false} onSubmit={() => {}} onCancel={() => {}} />);

    const submit = screen.getByRole("button", { name: "Refund remaining" });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Reason"), "reason");
    expect(submit).toBeEnabled();
  });

  test("per-item with nothing selected cannot submit", async () => {
    render(<RefundDialog entry={PURCHASE} busy={false} onSubmit={() => {}} onCancel={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Per item" }));
    await userEvent.type(screen.getByLabelText("Reason"), "reason");
    await userEvent.click(screen.getByRole("button", { name: "Refund one fewer Slice" }));
    await userEvent.click(screen.getByRole("button", { name: "Refund one fewer Slice" }));

    expect(screen.getByRole("button", { name: "Refund $0.00" })).toBeDisabled();
  });
});
