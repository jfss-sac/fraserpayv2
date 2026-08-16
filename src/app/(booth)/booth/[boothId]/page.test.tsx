import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { BoothDTO, BoothSummary } from "@/lib/shared/types";

const { getSession, isBoothMember, getBoothSummary, getBoothCatalog, notFound, redirect } =
  vi.hoisted(() => ({
    getSession: vi.fn(),
    isBoothMember: vi.fn(),
    getBoothSummary: vi.fn(),
    getBoothCatalog: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NOT_FOUND");
    }),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  }));

vi.mock("@/lib/server/dal", () => ({
  getSession,
  isBoothMember,
  getBoothSummary,
  getBoothCatalog,
}));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import BoothSummaryPage from "./page";

const SUMMARY: BoothSummary = {
  boothId: "booth-1",
  boothName: "Pizza Palace",
  status: "approved",
  grossCents: 1200,
  purchaseCount: 3,
  refundCount: 0,
  items: [
    { itemId: "slice", name: "Slice", qty: 4, revenueCents: 1200 },
    { itemId: "calzone", name: "Calzone", qty: 1, revenueCents: 500 },
  ],
};

const CATALOG: BoothDTO = {
  id: "booth-1",
  name: "Pizza Palace",
  description: "Slices by the pie.",
  status: "approved",
  items: [{ id: "slice", name: "Slice", priceCents: 300, isCustom: false }],
};

function page() {
  return BoothSummaryPage({ params: Promise.resolve({ boothId: "booth-1" }) });
}

beforeEach(() => {
  getSession.mockReset();
  isBoothMember.mockReset();
  getBoothSummary.mockReset();
  getBoothSummary.mockResolvedValue(SUMMARY);
  getBoothCatalog.mockReset();
  getBoothCatalog.mockResolvedValue(CATALOG);
  notFound.mockClear();
  redirect.mockClear();
});

async function renderForMember() {
  getSession.mockResolvedValue({ uid: "seller-1", roles: { sacMember: false, sacExec: false } });
  isBoothMember.mockResolvedValue(true);
  render(await page());
}

test("shows the totals to a member of the booth", async () => {
  await renderForMember();
  expect(screen.getByRole("heading", { name: "Pizza Palace" })).toBeInTheDocument();
  expect(screen.getByText("Gross sales").parentElement).toHaveTextContent("$12.00");
});

test("carries the booth tab bar with the dashboard tab current", async () => {
  await renderForMember();
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "History" })).toHaveAttribute(
    "href",
    "/booth/booth-1/history",
  );
});

test("offers a primary route into the POS", async () => {
  await renderForMember();
  expect(screen.getByRole("link", { name: "Process a sale" })).toHaveAttribute(
    "href",
    "/sell/booth-1",
  );
});

test("marks a breakdown row whose item is no longer sold", async () => {
  await renderForMember();
  expect(screen.getByText("Calzone")).toHaveTextContent("Calzone (archived)");
  expect(screen.getByText("Slice")).not.toHaveTextContent("(archived)");
});

test("withholds the sale action from a booth that cannot sell, and says why", async () => {
  getBoothSummary.mockResolvedValue({ ...SUMMARY, status: "pending" });
  await renderForMember();
  expect(screen.queryByRole("link", { name: "Process a sale" })).not.toBeInTheDocument();
  expect(screen.getByText(/awaiting sac approval/i)).toBeInTheDocument();
});

test("marks nothing archived when the catalog read comes back empty-handed", async () => {
  getBoothCatalog.mockResolvedValue(null);
  await renderForMember();
  expect(screen.queryByText(/\(archived\)/)).not.toBeInTheDocument();
});

test("turns away an exec who is not a member — seller tabs stay member-only", async () => {
  getSession.mockResolvedValue({ uid: "exec-1", roles: { sacMember: true, sacExec: true } });
  isBoothMember.mockResolvedValue(false);
  await expect(page()).rejects.toThrow("NOT_FOUND");
  expect(getBoothSummary).not.toHaveBeenCalled();
});
