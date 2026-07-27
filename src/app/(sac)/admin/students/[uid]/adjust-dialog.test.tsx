import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AdjustDialog, parseDollarsToCents, pointsPreview } from "./adjust-dialog";

describe("parseDollarsToCents", () => {
  test("accepts positive 50¢ multiples", () => {
    expect(parseDollarsToCents("10")).toBe(1000);
    expect(parseDollarsToCents("10.50")).toBe(1050);
    expect(parseDollarsToCents("0.50")).toBe(50);
  });

  test("rejects non-increments, zero, and junk", () => {
    expect(parseDollarsToCents("10.34")).toBeNull();
    expect(parseDollarsToCents("0")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
});

describe("pointsPreview", () => {
  test("reverses points pro-rata and never drops below zero", () => {
    expect(pointsPreview(52.5, -1050)).toBe(-52.5);
    expect(pointsPreview(20, -1050)).toBe(-20);
    expect(pointsPreview(0, -500)).toBe(0);
    expect(pointsPreview(10, 500)).toBe(25);
  });
});

describe("AdjustDialog", () => {
  test("submits a positive adjustment with the signed amount and reason", async () => {
    const onSubmit = vi.fn();
    render(
      <AdjustDialog
        studentName="Ben Carter"
        currentPoints={0}
        topups={[]}
        busy={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "5");
    await userEvent.type(screen.getByLabelText("Reason"), "cash box correction");
    await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

    expect(onSubmit).toHaveBeenCalledWith({ amountCents: 500, reason: "cash box correction" });
  });

  test("Remove credit yields a negative amount", async () => {
    const onSubmit = vi.fn();
    render(
      <AdjustDialog
        studentName="Ben Carter"
        currentPoints={0}
        topups={[]}
        busy={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove credit" }));
    await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "5");
    await userEvent.type(screen.getByLabelText("Reason"), "double credit");
    await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

    expect(onSubmit).toHaveBeenCalledWith({ amountCents: -500, reason: "double credit" });
  });

  test("linking a top-up shows the points reversal preview and passes originalEntryId", async () => {
    const onSubmit = vi.fn();
    render(
      <AdjustDialog
        studentName="Ben Carter"
        currentPoints={52.5}
        topups={[{ id: "topup-1", label: "Jul 20 · $10.50 (cash)" }]}
        busy={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remove credit" }));
    await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "10.50");
    await userEvent.selectOptions(
      screen.getByLabelText("Link to a top-up (reverses its points)"),
      "topup-1",
    );

    expect(screen.getByRole("status")).toHaveTextContent("-52.5");
    expect(screen.getByRole("status")).toHaveTextContent("0 total");

    await userEvent.type(screen.getByLabelText("Reason"), "erroneous top-up");
    await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

    expect(onSubmit).toHaveBeenCalledWith({
      amountCents: -1050,
      reason: "erroneous top-up",
      originalEntryId: "topup-1",
    });
  });

  test("submit is disabled until an amount and reason are present", async () => {
    render(
      <AdjustDialog
        studentName="Ben Carter"
        currentPoints={0}
        topups={[]}
        busy={false}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    const submit = screen.getByRole("button", { name: "Apply adjustment" });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "5");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Reason"), "reason");
    expect(submit).toBeEnabled();
  });
});
