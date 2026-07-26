import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { getSession, notFound } = vi.hoisted(() => ({
  getSession: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("./admin-nav", () => ({
  AdminNav: ({ items }: { items: { label: string }[] }) => (
    <nav aria-label="Admin sections">
      {items.map((i) => (
        <span key={i.label}>{i.label}</span>
      ))}
    </nav>
  ),
}));

import AdminLayout from "./layout";

function session(over: Partial<{ suspended: boolean; sacMember: boolean; sacExec: boolean }> = {}) {
  return {
    uid: "u1",
    email: "800001@pdsb.net",
    displayName: "u1",
    studentNumber: "800001",
    balanceCents: 0,
    points: 0,
    roles: { sacMember: over.sacMember ?? false, sacExec: over.sacExec ?? false },
    suspended: over.suspended ?? false,
  };
}

const PROPS = { children: <p>page body</p> };

beforeEach(() => {
  getSession.mockReset();
  notFound.mockClear();
});

describe("(sac)/admin layout gate (defense-in-depth, arch §5 / I9)", () => {
  test("404s an unauthenticated visitor reaching /admin directly", async () => {
    getSession.mockResolvedValue(null);
    await expect(AdminLayout(PROPS)).rejects.toThrow("NOT_FOUND");
  });

  test("404s a plain student reaching /admin directly", async () => {
    getSession.mockResolvedValue(session());
    await expect(AdminLayout(PROPS)).rejects.toThrow("NOT_FOUND");
  });

  test("404s a suspended SAC member (A3)", async () => {
    getSession.mockResolvedValue(session({ sacMember: true, suspended: true }));
    await expect(AdminLayout(PROPS)).rejects.toThrow("NOT_FOUND");
  });
});

describe("(sac)/admin capability-aware navigation", () => {
  test("a member sees all six sections and no exec-only nav", async () => {
    getSession.mockResolvedValue(session({ sacMember: true }));
    render(await AdminLayout(PROPS));
    for (const label of ["Feed", "Top-up", "Students", "Booths", "Reports", "Reconciliation"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
  });

  test("an exec sees the full navigation", async () => {
    getSession.mockResolvedValue(session({ sacExec: true }));
    render(await AdminLayout(PROPS));
    for (const label of ["Feed", "Top-up", "Students", "Booths", "Reports", "Reconciliation"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
