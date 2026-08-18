import { render as testingRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { BoothDetail } from "@/lib/shared/types";
import { ApiError } from "@/lib/ui/api-client";
import { ToastProvider } from "@/lib/ui/toast";
import { BoothManage } from "./booth-manage";

const mocks = vi.hoisted(() => ({
  addItem: vi.fn(),
  archiveItem: vi.fn(),
  refresh: vi.fn(),
  requestSacBoothHistory: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/ui/booth-history-api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/ui/booth-history-api")>(
    "@/lib/ui/booth-history-api",
  )),
  requestSacBoothHistory: mocks.requestSacBoothHistory,
}));
vi.mock("../api", async () => ({
  ...(await vi.importActual<typeof import("../api")>("../api")),
  addItem: mocks.addItem,
  archiveItem: mocks.archiveItem,
}));

function render(ui: React.ReactNode) {
  return testingRender(ui, { wrapper: ToastProvider });
}

const PENDING: BoothDetail = {
  id: "booth-pending",
  name: "Taco Stand",
  description: "Fresh tacos.",
  status: "pending",
  items: [
    { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
    { id: "taco", name: "Taco", priceCents: 300, isCustom: false },
  ],
  joinCode: null,
  submitterUid: "teacher-uid",
  submitterEmail: "jmurray@pdsb.net",
  createdAt: "2026-07-20T12:00:00.000Z",
  approvedAt: null,
  members: [],
  summary: null,
};

const APPROVED: BoothDetail = {
  id: "booth-approved",
  name: "Pizza Palace",
  description: "Slices by the pie.",
  status: "approved",
  items: [
    { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
    { id: "slice", name: "Slice", priceCents: 300, isCustom: false },
    { id: "calzone", name: "Calzone", priceCents: 550, isCustom: false, archived: true },
  ],
  joinCode: "PIZZ-9K4M7",
  submitterUid: "teacher-uid",
  submitterEmail: "jmurray@pdsb.net",
  createdAt: "2026-07-20T12:00:00.000Z",
  approvedAt: "2026-07-21T12:00:00.000Z",
  members: [{ uid: "seller-1", displayName: "Ava Nguyen", joinedAt: "2026-07-21T13:00:00.000Z" }],
  summary: {
    boothId: "booth-approved",
    boothName: "Pizza Palace",
    status: "approved",
    grossCents: 1200,
    purchaseCount: 3,
    refundCount: 1,
    items: [{ itemId: "slice", name: "Slice", qty: 4, revenueCents: 1200 }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addItem.mockResolvedValue({
    boothId: APPROVED.id,
    item: { id: "poutine", name: "Poutine", priceCents: 450, isCustom: false },
  });
  mocks.archiveItem.mockResolvedValue({
    boothId: APPROVED.id,
    itemId: "slice",
    archived: true,
  });
});

describe("BoothManage — pending", () => {
  test("surfaces the submitter email for the teacher check", () => {
    render(<BoothManage detail={PENDING} isExec={true} />);
    expect(screen.getByText("Submitted by")).toBeInTheDocument();
    expect(screen.getByText("jmurray@pdsb.net")).toBeInTheDocument();
  });

  test("an exec can approve; a member sees read-only items", () => {
    const { rerender } = render(<BoothManage detail={PENDING} isExec={true} />);
    expect(screen.getByRole("button", { name: "Approve booth" })).toBeInTheDocument();
    expect(screen.getByLabelText("Taco price in dollars")).toBeInTheDocument();

    rerender(<BoothManage detail={PENDING} isExec={false} />);
    expect(screen.queryByRole("button", { name: "Approve booth" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Taco price in dollars")).not.toBeInTheDocument();
    expect(screen.getByText("Only execs can approve booths.")).toBeInTheDocument();
    expect(screen.getByText("jmurray@pdsb.net")).toBeInTheDocument();
  });
});

describe("BoothManage — approved", () => {
  test("shows the join code and sales to everyone", () => {
    render(<BoothManage detail={APPROVED} isExec={false} />);
    expect(screen.getByText("PIZZ-9K4M7")).toBeInTheDocument();
    const gross = screen.getByText("Gross").parentElement!;
    expect(gross).toHaveTextContent("$12.00");
    expect(screen.getByText("Ava Nguyen")).toBeInTheDocument();
  });

  test("shows all booth history without a mine filter on the History tab", async () => {
    const user = userEvent.setup();
    mocks.requestSacBoothHistory.mockResolvedValueOnce({ entries: [], nextCursor: null });
    render(<BoothManage detail={APPROVED} isExec={false} />);

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(await screen.findByText("No sales yet.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter sales" })).not.toBeInTheDocument();
    expect(mocks.requestSacBoothHistory).toHaveBeenCalledWith("booth-approved", {});
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  });

  test("a member gets no mutating controls", () => {
    render(<BoothManage detail={APPROVED} isExec={false} />);
    for (const name of ["Rotate code", "Save prices", "Remove", "Deactivate"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: /^(Add item|Archive|Restore)/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Slice price in dollars")).not.toBeInTheDocument();
  });

  test("shows archived items under No longer sold at their last price", () => {
    render(<BoothManage detail={APPROVED} isExec={false} />);
    expect(screen.getByRole("heading", { name: "No longer sold" })).toBeInTheDocument();
    expect(screen.getByText("Calzone")).toBeInTheDocument();
    expect(screen.getByText("$5.50")).toBeInTheDocument();
    expect(screen.queryByLabelText("Calzone price in dollars")).not.toBeInTheDocument();
  });

  test("an exec can open the POS for a booth they never joined", () => {
    render(<BoothManage detail={APPROVED} isExec={true} />);
    expect(screen.getByRole("link", { name: "Sell for this booth" })).toHaveAttribute(
      "href",
      "/sell/booth-approved",
    );
  });

  test("a non-exec member gets no way in — decision 2 is exec-only", () => {
    render(<BoothManage detail={APPROVED} isExec={false} />);
    expect(screen.queryByRole("link", { name: "Sell for this booth" })).not.toBeInTheDocument();
  });

  test("a deactivated booth offers no POS entry, even to an exec", () => {
    render(<BoothManage detail={{ ...APPROVED, status: "deactivated" }} isExec={true} />);
    expect(screen.queryByRole("link", { name: "Sell for this booth" })).not.toBeInTheDocument();
  });

  test("an exec gets rotate, price edit, member removal, and deactivate", () => {
    render(<BoothManage detail={APPROVED} isExec={true} />);
    expect(screen.getByRole("button", { name: "Rotate code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save prices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(screen.getByLabelText("Slice price in dollars")).toBeInTheDocument();
  });

  test("an exec can add an item and refresh the page", async () => {
    const user = userEvent.setup();
    render(<BoothManage detail={APPROVED} isExec={true} />);

    await user.type(screen.getByLabelText("Item name"), "Poutine");
    await user.type(screen.getByLabelText("Price ($)"), "4.50");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() =>
      expect(mocks.addItem).toHaveBeenCalledWith("booth-approved", {
        name: "Poutine",
        priceCents: 450,
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Item name")).toHaveValue("");
    expect(screen.getByLabelText("Price ($)")).toHaveValue("");
  });

  test("an exec can archive and restore an item", async () => {
    const user = userEvent.setup();
    render(<BoothManage detail={APPROVED} isExec={true} />);

    await user.click(screen.getByRole("button", { name: "Archive Slice" }));
    await waitFor(() =>
      expect(mocks.archiveItem).toHaveBeenCalledWith("booth-approved", "slice", true),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Restore Calzone" }));
    await waitFor(() =>
      expect(mocks.archiveItem).toHaveBeenCalledWith("booth-approved", "calzone", false),
    );
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  test("surfaces the item ceiling conflict as a toast", async () => {
    const user = userEvent.setup();
    mocks.addItem.mockRejectedValueOnce(
      new ApiError("CONFLICT", "Archive one before adding another."),
    );
    render(<BoothManage detail={APPROVED} isExec={true} />);

    await user.type(screen.getByLabelText("Item name"), "Poutine");
    await user.type(screen.getByLabelText("Price ($)"), "4.50");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Archive one before adding another."),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
