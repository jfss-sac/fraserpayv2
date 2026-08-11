import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

test("focuses Cancel instead of the destructive action when a dangerous dialog opens", () => {
  render(
    <ConfirmDialog
      title="Suspend account?"
      confirmLabel="Suspend"
      busy={false}
      danger
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    >
      <p>The account will be blocked until unsuspended.</p>
    </ConfirmDialog>,
  );

  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Suspend" })).not.toHaveFocus();
});

test("focuses the primary action when a non-destructive dialog opens", () => {
  render(
    <ConfirmDialog
      title="Reactivate booth?"
      confirmLabel="Reactivate"
      busy={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    >
      <p>The booth can sell again.</p>
    </ConfirmDialog>,
  );

  expect(screen.getByRole("button", { name: "Reactivate" })).toHaveFocus();
});
