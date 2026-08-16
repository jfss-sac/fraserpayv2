import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import type { BoothItem } from "@/lib/shared/types";
import { PriceEditor } from "./price-editor";

const ITEMS: BoothItem[] = [
  { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
  { id: "taco", name: "Taco", priceCents: 300, isCustom: false },
  { id: "burrito", name: "Burrito", priceCents: 500, isCustom: false },
  { id: "old", name: "Old item", priceCents: 250, isCustom: false, archived: true },
];

function renderEditor(props?: Partial<React.ComponentProps<typeof PriceEditor>>) {
  const onSubmit = vi.fn();
  render(
    <PriceEditor
      items={ITEMS}
      submitLabel="Save prices"
      busy={false}
      allowNoChange={false}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

describe("PriceEditor", () => {
  test("the custom item is shown locked with no editable input", () => {
    renderEditor();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.queryByLabelText("Custom price in dollars")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Taco price in dollars")).toHaveValue("3.00");
  });

  test("archived items are not listed in the price editor", () => {
    renderEditor();
    expect(screen.queryByLabelText("Old item price in dollars")).not.toBeInTheDocument();
    expect(screen.queryByText("Old item")).not.toBeInTheDocument();
  });

  test("submits only the changed items as price edits", async () => {
    const { onSubmit } = renderEditor();

    const taco = screen.getByLabelText("Taco price in dollars");
    await userEvent.clear(taco);
    await userEvent.type(taco, "3.50");

    await userEvent.click(screen.getByRole("button", { name: "Save prices" }));

    expect(onSubmit).toHaveBeenCalledWith([{ id: "taco", priceCents: 350 }]);
  });

  test("submit is disabled until something changes", async () => {
    renderEditor();
    const submit = screen.getByRole("button", { name: "Save prices" });
    expect(submit).toBeDisabled();

    const taco = screen.getByLabelText("Taco price in dollars");
    await userEvent.clear(taco);
    await userEvent.type(taco, "4.00");
    expect(submit).toBeEnabled();
  });

  test("a non-multiple-of-50 price blocks submission", async () => {
    renderEditor();
    const taco = screen.getByLabelText("Taco price in dollars");
    await userEvent.clear(taco);
    await userEvent.type(taco, "3.33");

    expect(screen.getByRole("button", { name: "Save prices" })).toBeDisabled();
    expect(screen.getByText("Prices must be a positive multiple of $0.50.")).toBeInTheDocument();
  });

  test("with allowNoChange it approves with an empty edit list", async () => {
    const { onSubmit } = renderEditor({ allowNoChange: true, submitLabel: "Approve booth" });
    await userEvent.click(screen.getByRole("button", { name: "Approve booth" }));
    expect(onSubmit).toHaveBeenCalledWith([]);
  });
});
