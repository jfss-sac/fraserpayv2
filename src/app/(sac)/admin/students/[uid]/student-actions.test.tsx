import { render as testingRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import type { SacLedgerEntry, StudentDetail } from "@/lib/shared/types";
import { ToastProvider } from "@/lib/ui/toast";
import { StudentActions } from "./student-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function render(ui: React.ReactNode) {
  return testingRender(ui, { wrapper: ToastProvider });
}

const STUDENT: StudentDetail = {
  uid: "stu-1",
  displayName: "Ben Carter",
  studentNumber: "123456",
  email: "ben@example.com",
  balanceCents: 5000,
  points: 0,
  suspended: false,
  hasPaymentCode: true,
  roles: { sacMember: false, sacExec: false },
};

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

function keyOf(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get("idempotency-key");
}

function bodyOf(call: unknown[]): string {
  return (call[1] as RequestInit).body as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("keeps the adjust dialog open and reuses the idempotency key on a network retry", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <StudentActions
      student={STUDENT}
      viewerUid="exec-1"
      isExec
      initialEntries={[]}
      initialCursor={null}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Adjust balance" }));
  await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "5");
  await userEvent.type(screen.getByLabelText("Reason"), "cash box correction");
  await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

  expect(screen.getByLabelText("Reason")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(bodyOf(fetchMock.mock.calls[1]!)).toBe(bodyOf(fetchMock.mock.calls[0]!));
  expect(keyOf(fetchMock.mock.calls[0]!)).toBe(keyOf(fetchMock.mock.calls[1]!));
});

test("keeps the refund dialog open and reuses the idempotency key on a network retry", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <StudentActions
      student={STUDENT}
      viewerUid="exec-1"
      isExec
      initialEntries={[PURCHASE]}
      initialCursor={null}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Refund" }));
  await userEvent.type(screen.getByLabelText("Reason"), "duplicate charge");
  await userEvent.click(screen.getByRole("button", { name: "Refund remaining" }));

  expect(screen.getByLabelText("Reason")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Refund remaining" }));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(bodyOf(fetchMock.mock.calls[1]!)).toBe(bodyOf(fetchMock.mock.calls[0]!));
  expect(keyOf(fetchMock.mock.calls[0]!)).toBe(keyOf(fetchMock.mock.calls[1]!));
});

test("holds a failed adjustment's key even after a refund runs in between", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <StudentActions
      student={STUDENT}
      viewerUid="exec-1"
      isExec
      initialEntries={[PURCHASE]}
      initialCursor={null}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Adjust balance" }));
  await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "5");
  await userEvent.type(screen.getByLabelText("Reason"), "cash box correction");
  await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await userEvent.click(screen.getByRole("button", { name: "Refund" }));
  await userEvent.type(screen.getByLabelText("Reason"), "duplicate charge");
  await userEvent.click(screen.getByRole("button", { name: "Refund remaining" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await userEvent.click(screen.getByRole("button", { name: "Adjust balance" }));
  await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "5");
  await userEvent.type(screen.getByLabelText("Reason"), "cash box correction");
  await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(bodyOf(fetchMock.mock.calls[2]!)).toBe(bodyOf(fetchMock.mock.calls[0]!));
  expect(keyOf(fetchMock.mock.calls[2]!)).toBe(keyOf(fetchMock.mock.calls[0]!));
});

test("mints a fresh idempotency key when the reason is edited before the retry", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <StudentActions
      student={STUDENT}
      viewerUid="exec-1"
      isExec
      initialEntries={[]}
      initialCursor={null}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Adjust balance" }));
  await userEvent.type(screen.getByLabelText("Adjustment amount in dollars"), "5");
  await userEvent.type(screen.getByLabelText("Reason"), "cash box");
  await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

  await userEvent.type(screen.getByLabelText("Reason"), " correction");
  await userEvent.click(screen.getByRole("button", { name: "Apply adjustment" }));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(bodyOf(fetchMock.mock.calls[1]!)).not.toBe(bodyOf(fetchMock.mock.calls[0]!));
  expect(keyOf(fetchMock.mock.calls[0]!)).not.toBe(keyOf(fetchMock.mock.calls[1]!));
});
