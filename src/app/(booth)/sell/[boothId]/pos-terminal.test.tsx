import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { BuyerPanel } from "./pos-terminal";

test("prompts to confirm the buyer's name once known", () => {
  render(
    <BuyerPanel
      state={{ status: "ready", name: "Ada Lovelace", sufficient: true }}
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
      state={{ status: "ready", name: "Ada", sufficient: false }}
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
      state={{ status: "ready", name: "Ada", sufficient: true }}
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
      state={{ status: "ready", name: "Ada", sufficient: true }}
      typed={false}
      onClear={onClear}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Not them — scan again" }));
  expect(onClear).toHaveBeenCalledOnce();
});
