import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { TOAST_DURATION_MS, Toaster, useToasts } from "./toast";

afterEach(() => {
  vi.useRealTimers();
});

test("push adds a toast and dismiss removes it", () => {
  const { result } = renderHook(() => useToasts());

  act(() => {
    result.current.push("Charged $5.00 to Ada", "success");
  });
  expect(result.current.toasts).toHaveLength(1);
  const id = result.current.toasts[0]!.id;

  act(() => {
    result.current.dismiss(id);
  });
  expect(result.current.toasts).toHaveLength(0);
});

test("renders success toasts as status and error toasts as alert", () => {
  render(
    <Toaster
      toasts={[
        { id: "a", message: "Charged $5.00 to Ada", variant: "success" },
        { id: "b", message: "Balance can't cover this cart.", variant: "error" },
      ]}
      onDismiss={() => {}}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Charged $5.00 to Ada");
  expect(screen.getByRole("alert")).toHaveTextContent("Balance can't cover this cart.");
});

test("auto-dismisses a toast after the duration elapses", () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  render(
    <Toaster
      toasts={[{ id: "a", message: "Charged", variant: "success" }]}
      onDismiss={onDismiss}
    />,
  );

  expect(onDismiss).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(TOAST_DURATION_MS);
  });
  expect(onDismiss).toHaveBeenCalledWith("a");
});

test("dismisses a toast when the close button is pressed", async () => {
  const user = userEvent.setup();
  const onDismiss = vi.fn();
  render(
    <Toaster
      toasts={[{ id: "a", message: "Charged", variant: "success" }]}
      onDismiss={onDismiss}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledWith("a");
});
