import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { BoothDetail } from "@/lib/shared/types";
import { BoothManage } from "./booth-manage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

  test("a member gets no mutating controls", () => {
    render(<BoothManage detail={APPROVED} isExec={false} />);
    for (const name of ["Rotate code", "Save prices", "Remove", "Deactivate"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Slice price in dollars")).not.toBeInTheDocument();
  });

  test("an exec gets rotate, price edit, member removal, and deactivate", () => {
    render(<BoothManage detail={APPROVED} isExec={true} />);
    expect(screen.getByRole("button", { name: "Rotate code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save prices" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(screen.getByLabelText("Slice price in dollars")).toBeInTheDocument();
  });
});
