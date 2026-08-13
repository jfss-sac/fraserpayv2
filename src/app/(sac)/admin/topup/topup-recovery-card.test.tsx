import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { type PendingTopUp, PENDING_TOPUP_RETRY_WINDOW_MS } from "@/lib/ui/pending-topup";
import { TopUpRecoveryCard } from "./topup-recovery-card";

function pendingTopUp(ageMs = 0): PendingTopUp {
  return {
    key: "8f1d4a2e-6b3c-4a7d-9e2f-0c5b8a1d3e6f",
    sessionId: "session-1",
    buyer: { studentNumber: "123456" },
    studentName: "Ada Lovelace",
    amountCents: 1000,
    method: "cash",
    startedAt: Date.now() - ageMs,
  };
}

test("names the amount and student of the top-up that may not have landed", () => {
  render(<TopUpRecoveryCard pending={pendingTopUp()} onRetry={() => {}} onDismiss={() => {}} />);

  expect(screen.getByText(/\$10\.00 for Ada Lovelace/)).toBeInTheDocument();
  expect(screen.getByText(/cannot top up twice/)).toBeInTheDocument();
  expect(screen.getByText(/only Retry can reuse the original key/)).toBeInTheDocument();
});

test("retries with the top-up that was recovered", async () => {
  const onRetry = vi.fn();
  const pending = pendingTopUp();
  render(<TopUpRecoveryCard pending={pending} onRetry={onRetry} onDismiss={() => {}} />);

  await userEvent.click(screen.getByRole("button", { name: "Retry top-up" }));
  expect(onRetry).toHaveBeenCalledWith(pending);
});

test("lets the member dismiss it", async () => {
  const onDismiss = vi.fn();
  render(
    <TopUpRecoveryCard pending={pendingTopUp()} onRetry={() => {}} onDismiss={onDismiss} />, //
  );

  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onDismiss).toHaveBeenCalledOnce();
});

test("withdraws retry once the safe window has passed", () => {
  render(
    <TopUpRecoveryCard
      pending={pendingTopUp(PENDING_TOPUP_RETRY_WINDOW_MS + 1000)}
      onRetry={() => {}}
      onDismiss={() => {}}
    />,
  );

  expect(screen.queryByRole("button", { name: "Retry top-up" })).not.toBeInTheDocument();
  expect(screen.getByText(/check the feed for this top-up/)).toBeInTheDocument();
});

test("blocks a second retry while one is in flight", () => {
  render(
    <TopUpRecoveryCard pending={pendingTopUp()} busy onRetry={() => {}} onDismiss={() => {}} />,
  );

  expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeDisabled();
});
