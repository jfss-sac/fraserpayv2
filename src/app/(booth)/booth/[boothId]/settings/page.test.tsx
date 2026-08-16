import { render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { BoothSettingsDTO } from "@/lib/shared/types";

const { getSession, isBoothMember, getBoothSettings, notFound, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  isBoothMember: vi.fn(),
  getBoothSettings: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession, isBoothMember, getBoothSettings }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import BoothSettingsPage from "./page";

const SETTINGS: BoothSettingsDTO = {
  id: "booth-1",
  name: "Pizza Palace",
  description: "Slices by the pie.",
  status: "approved",
  items: [
    { id: "slice", name: "Slice", priceCents: 300, isCustom: false },
    { id: "custom", name: "Custom", priceCents: 50, isCustom: true },
  ],
  archivedItems: [{ id: "calzone", name: "Calzone", priceCents: 550, isCustom: false }],
  memberNames: ["Ada Lovelace", "Grace Hopper"],
};

function page() {
  return BoothSettingsPage({ params: Promise.resolve({ boothId: "booth-1" }) });
}

function sectionFor(heading: string): HTMLElement {
  const element = screen.getByRole("heading", { name: heading }).parentElement;
  if (!element) throw new Error(`no section around "${heading}"`);
  return element;
}

beforeEach(() => {
  getSession.mockReset();
  isBoothMember.mockReset();
  getBoothSettings.mockReset();
  getBoothSettings.mockResolvedValue(SETTINGS);
  notFound.mockClear();
  redirect.mockClear();
});

async function renderForMember(settings: BoothSettingsDTO = SETTINGS) {
  getSession.mockResolvedValue({ uid: "seller-1", roles: { sacMember: false, sacExec: false } });
  isBoothMember.mockResolvedValue(true);
  getBoothSettings.mockResolvedValue(settings);
  return render(await page());
}

test("names the booth, its status and what it sells", async () => {
  await renderForMember();

  expect(screen.getByRole("heading", { name: "Pizza Palace" })).toBeInTheDocument();
  expect(screen.getByText("Approved")).toBeInTheDocument();
  expect(screen.getByText("Slices by the pie.")).toBeInTheDocument();

  const items = sectionFor("Items & prices");
  expect(within(items).getByText("Slice")).toBeInTheDocument();
  expect(within(items).getByText("$3.00")).toBeInTheDocument();
  expect(within(items).getByText("Custom")).toBeInTheDocument();
});

test("prices the custom item the way the POS does, not as a 50-cent product", async () => {
  await renderForMember();

  const items = sectionFor("Items & prices");
  expect(within(items).getByText("$0.50 × N")).toBeInTheDocument();
  expect(within(items).queryByText("$0.50")).not.toBeInTheDocument();
});

test("carries the booth tab bar with the settings tab current", async () => {
  await renderForMember();

  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/booth/booth-1");
});

test("names SAC as the change path rather than offering an editor", async () => {
  await renderForMember();

  expect(screen.getByText("Contact a SAC member if changes are needed.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("keeps retired items in their own section, at the price they last sold for", async () => {
  await renderForMember();

  const archived = sectionFor("No longer sold");
  expect(within(archived).getByText("Calzone")).toBeInTheDocument();
  expect(within(archived).getByText("$5.50")).toBeInTheDocument();
  expect(within(sectionFor("Items & prices")).queryByText("Calzone")).not.toBeInTheDocument();
});

test("drops the retired section when nothing has been retired", async () => {
  await renderForMember({ ...SETTINGS, archivedItems: [] });

  expect(screen.queryByRole("heading", { name: "No longer sold" })).not.toBeInTheDocument();
});

test("lists the members by name, with no email and no removal control", async () => {
  const { container } = await renderForMember();

  const members = sectionFor("Members");
  expect(within(members).getByText("Ada Lovelace")).toBeInTheDocument();
  expect(within(members).getByText("Grace Hopper")).toBeInTheDocument();
  expect(within(members).queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  expect(container.textContent).not.toContain("@");
});

test("shows the join code nowhere — re-sharing entry stays an exec act (decision 9)", async () => {
  const { container } = await renderForMember();

  const text = container.textContent ?? "";
  expect(text).not.toMatch(/join/i);
  expect(text).not.toMatch(/[A-Z]{4}-[A-Z0-9]{5}/);
});

test("turns away an exec who is not a member — seller tabs stay member-only", async () => {
  getSession.mockResolvedValue({ uid: "exec-1", roles: { sacMember: true, sacExec: true } });
  isBoothMember.mockResolvedValue(false);

  await expect(page()).rejects.toThrow("NOT_FOUND");
  expect(getBoothSettings).not.toHaveBeenCalled();
});

test("turns away a member whose booth document is gone", async () => {
  getSession.mockResolvedValue({ uid: "seller-1", roles: { sacMember: false, sacExec: false } });
  isBoothMember.mockResolvedValue(true);
  getBoothSettings.mockResolvedValue(null);

  await expect(page()).rejects.toThrow("NOT_FOUND");
});

test("sends a signed-out visitor to the login page", async () => {
  getSession.mockResolvedValue(null);

  await expect(page()).rejects.toThrow("REDIRECT:/login");
  expect(isBoothMember).not.toHaveBeenCalled();
});
