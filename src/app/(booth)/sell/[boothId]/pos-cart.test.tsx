import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { BoothItem } from "@/lib/shared/types";
import { PosCart, cartItemCount, cartTotalCents } from "./pos-cart";

const TACO: BoothItem = { id: "taco", name: "Taco", priceCents: 250, isCustom: false };
const WATER: BoothItem = { id: "water", name: "Water", priceCents: 150, isCustom: false };
const CUSTOM: BoothItem = { id: "custom", name: "Custom", priceCents: 50, isCustom: true };
const ITEMS = [TACO, WATER, CUSTOM];

test("cartTotalCents and cartItemCount sum quantities", () => {
  expect(cartTotalCents(ITEMS, { taco: 2, custom: 3 })).toBe(650);
  expect(cartItemCount({ taco: 2, custom: 3 })).toBe(5);
  expect(cartTotalCents(ITEMS, {})).toBe(0);
});

test("total starts at zero with the decrement disabled", () => {
  render(<PosCart items={ITEMS} />);
  expect(screen.getByLabelText("Cart total")).toHaveTextContent("$0.00");
  expect(screen.getByRole("button", { name: "Remove one Taco" })).toBeDisabled();
});

test("adding items updates the running total and quantity", async () => {
  render(<PosCart items={ITEMS} />);
  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));

  expect(screen.getByLabelText("Taco quantity")).toHaveTextContent("2");
  expect(screen.getByLabelText("Cart total")).toHaveTextContent("$5.00");
});

test("removing decrements and never drops below zero", async () => {
  render(<PosCart items={ITEMS} />);
  const add = screen.getByRole("button", { name: "Add Taco" });
  await userEvent.click(add);
  await userEvent.click(add);
  await userEvent.click(screen.getByRole("button", { name: "Remove one Taco" }));

  expect(screen.getByLabelText("Taco quantity")).toHaveTextContent("1");
  expect(screen.getByLabelText("Cart total")).toHaveTextContent("$2.50");

  await userEvent.click(screen.getByRole("button", { name: "Remove one Taco" }));
  expect(screen.getByLabelText("Taco quantity")).toHaveTextContent("0");
  expect(screen.getByRole("button", { name: "Remove one Taco" })).toBeDisabled();
});

test("custom item shows the $0.50 × N explainer and multiplies", async () => {
  render(<PosCart items={ITEMS} />);
  expect(screen.getByText("$0.50 × N")).toBeInTheDocument();

  const add = screen.getByRole("button", { name: "Add Custom" });
  await userEvent.click(add);
  await userEvent.click(add);
  await userEvent.click(add);

  expect(screen.getByLabelText("Custom quantity")).toHaveTextContent("3");
  expect(screen.getByLabelText("Cart total")).toHaveTextContent("$1.50");
});

test("mixed cart totals across items", async () => {
  render(<PosCart items={ITEMS} />);
  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  await userEvent.click(screen.getByRole("button", { name: "Add Water" }));
  await userEvent.click(screen.getByRole("button", { name: "Add Custom" }));

  expect(screen.getByLabelText("Cart total")).toHaveTextContent("$7.00");
  expect(screen.getByText("4 items")).toBeInTheDocument();
});

test("Charge is disabled while the cart is empty and enabled once items are added", async () => {
  const onCharge = vi.fn();
  render(<PosCart items={ITEMS} onCharge={onCharge} />);

  const charge = screen.getByRole("button", { name: "Charge" });
  expect(charge).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  expect(charge).toBeEnabled();

  await userEvent.click(charge);
  expect(onCharge).toHaveBeenCalledWith({ taco: 1 });
});

test("Charge stays disabled without a charge handler", async () => {
  render(<PosCart items={ITEMS} />);
  await userEvent.click(screen.getByRole("button", { name: "Add Taco" }));
  expect(screen.getByRole("button", { name: "Charge" })).toBeDisabled();
});
