import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { getSession, hasAnyBoothMembership, notFound, redirect, buildModes } = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasAnyBoothMembership: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  buildModes: vi.fn(() => []),
}));

vi.mock("@/lib/server/dal", () => ({ getSession, hasAnyBoothMembership }));
vi.mock("next/navigation", () => ({ notFound, redirect }));
vi.mock("@/lib/ui/sw-register", () => ({ ServiceWorkerRegister: () => null }));
vi.mock("@/lib/ui/shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  buildModes,
}));

import BoothLayout from "./layout";

function session(overrides: Partial<{ suspended: boolean; sacExec: boolean }> = {}) {
  return {
    uid: "u1",
    suspended: overrides.suspended ?? false,
    roles: { sacMember: overrides.sacExec ?? false, sacExec: overrides.sacExec ?? false },
  };
}

beforeEach(() => {
  getSession.mockReset();
  hasAnyBoothMembership.mockReset();
  notFound.mockClear();
  redirect.mockClear();
  buildModes.mockClear();
});

test("admits a booth member", async () => {
  getSession.mockResolvedValue(session());
  hasAnyBoothMembership.mockResolvedValue(true);
  render(await BoothLayout({ children: <p>booth area</p> }));
  expect(screen.getByText("booth area")).toBeInTheDocument();
});

test("admits an exec who belongs to no booth — the POS is reachable for them", async () => {
  getSession.mockResolvedValue(session({ sacExec: true }));
  hasAnyBoothMembership.mockResolvedValue(false);
  render(await BoothLayout({ children: <p>booth area</p> }));
  expect(screen.getByText("booth area")).toBeInTheDocument();
});

test("gives that exec no app-level Sell mode — they arrive from /admin/booths/[id] (decision 8)", async () => {
  const roles = { sacMember: true, sacExec: true };
  getSession.mockResolvedValue({ uid: "u1", suspended: false, roles });
  hasAnyBoothMembership.mockResolvedValue(false);
  await BoothLayout({ children: null });
  expect(buildModes).toHaveBeenCalledWith(roles, false);
});

test("turns away a student who belongs to no booth", async () => {
  getSession.mockResolvedValue(session());
  hasAnyBoothMembership.mockResolvedValue(false);
  await expect(BoothLayout({ children: null })).rejects.toThrow("NOT_FOUND");
});

test("turns away a suspended exec", async () => {
  getSession.mockResolvedValue(session({ sacExec: true, suspended: true }));
  hasAnyBoothMembership.mockResolvedValue(true);
  await expect(BoothLayout({ children: null })).rejects.toThrow("NOT_FOUND");
});

test("sends a signed-out visitor to /login", async () => {
  getSession.mockResolvedValue(null);
  await expect(BoothLayout({ children: null })).rejects.toThrow("REDIRECT:/login");
});
