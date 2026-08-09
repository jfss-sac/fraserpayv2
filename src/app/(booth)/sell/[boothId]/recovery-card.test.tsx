import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { type PendingCharge, PENDING_CHARGE_RETRY_WINDOW_MS } from "@/lib/ui/pending-charge";
import { RecoveryCard } from "./recovery-card";

function pendingCharge(ageMs = 0): PendingCharge {
  return {
    key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
    sessionId: "session-1",
    buyer: { studentNumber: "123456" },
    buyerName: "Ada Lovelace",
    items: [{ itemId: "taco", qty: 2 }],
    amountCents: 450,
    startedAt: Date.now() - ageMs,
  };
}

test("names the amount and buyer of the charge that may not have landed", () => {
  render(<RecoveryCard pending={pendingCharge()} onRetry={() => {}} onDismiss={() => {}} />);
  expect(screen.getByText(/\$4\.50 to Ada Lovelace/)).toBeInTheDocument();
  expect(screen.getByText(/cannot charge twice/)).toBeInTheDocument();
});

test("retries with the charge that was recovered", async () => {
  const onRetry = vi.fn();
  const pending = pendingCharge();
  render(<RecoveryCard pending={pending} onRetry={onRetry} onDismiss={() => {}} />);

  await userEvent.click(screen.getByRole("button", { name: "Retry charge" }));
  expect(onRetry).toHaveBeenCalledWith(pending);
});

test("lets the operator dismiss it", async () => {
  const onDismiss = vi.fn();
  render(<RecoveryCard pending={pendingCharge()} onRetry={() => {}} onDismiss={onDismiss} />);

  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledOnce();
});

test("withdraws retry once the safe window has passed", () => {
  render(
    <RecoveryCard
      pending={pendingCharge(PENDING_CHARGE_RETRY_WINDOW_MS + 1000)}
      onRetry={() => {}}
      onDismiss={() => {}}
    />,
  );

  expect(screen.queryByRole("button", { name: "Retry charge" })).not.toBeInTheDocument();
  expect(screen.getByText(/ask SAC to check the feed/)).toBeInTheDocument();
});

test("blocks a second retry while one is in flight", () => {
  render(<RecoveryCard pending={pendingCharge()} busy onRetry={() => {}} onDismiss={() => {}} />);
  expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
});

test("blocks dismissing while a retry is in flight, even once the card expires", () => {
  render(
    <RecoveryCard
      pending={pendingCharge(PENDING_CHARGE_RETRY_WINDOW_MS + 1000)}
      busy
      onRetry={() => {}}
      onDismiss={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
});

test("withholds retry while offline but still allows dismissing", () => {
  render(
    <RecoveryCard
      pending={pendingCharge()}
      online={false}
      onRetry={() => {}}
      onDismiss={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Retry charge" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
});
