import { beforeEach, describe, expect, test, vi } from "vitest";

const { getSession, hasAnyBoothMembership, redirect, notFound } = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasAnyBoothMembership: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession, hasAnyBoothMembership }));
vi.mock("next/navigation", () => ({ redirect, notFound }));
vi.mock("@/lib/ui/shell", () => ({
  AppShell: () => null,
  buildModes: () => [],
}));

import StudentLayout from "@/app/(student)/layout";
import BoothLayout from "@/app/(booth)/layout";
import SacLayout from "@/app/(sac)/layout";

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

const STUDENT = { children: null };

beforeEach(() => {
  getSession.mockReset();
  hasAnyBoothMembership.mockReset();
  redirect.mockClear();
  notFound.mockClear();
});

describe("(student) layout gate", () => {
  test("redirects an unauthenticated visitor to /login", async () => {
    getSession.mockResolvedValue(null);
    await expect(StudentLayout(STUDENT)).rejects.toThrow("REDIRECT:/login");
  });

  test("admits any authenticated user, including a suspended one", async () => {
    getSession.mockResolvedValue(session({ suspended: true }));
    hasAnyBoothMembership.mockResolvedValue(false);
    await expect(StudentLayout(STUDENT)).resolves.toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });
});

describe("(booth) layout gate", () => {
  test("redirects an unauthenticated visitor to /login", async () => {
    getSession.mockResolvedValue(null);
    await expect(BoothLayout(STUDENT)).rejects.toThrow("REDIRECT:/login");
  });

  test("404s a user who belongs to no booth", async () => {
    getSession.mockResolvedValue(session());
    hasAnyBoothMembership.mockResolvedValue(false);
    await expect(BoothLayout(STUDENT)).rejects.toThrow("NOT_FOUND");
  });

  test("404s a suspended booth member (A3)", async () => {
    getSession.mockResolvedValue(session({ suspended: true }));
    hasAnyBoothMembership.mockResolvedValue(true);
    await expect(BoothLayout(STUDENT)).rejects.toThrow("NOT_FOUND");
  });

  test("admits an active booth member", async () => {
    getSession.mockResolvedValue(session());
    hasAnyBoothMembership.mockResolvedValue(true);
    await expect(BoothLayout(STUDENT)).resolves.toBeTruthy();
  });
});

describe("(sac) layout gate", () => {
  test("redirects an unauthenticated visitor to /login", async () => {
    getSession.mockResolvedValue(null);
    await expect(SacLayout(STUDENT)).rejects.toThrow("REDIRECT:/login");
  });

  test("404s a plain student reaching /admin", async () => {
    getSession.mockResolvedValue(session());
    hasAnyBoothMembership.mockResolvedValue(false);
    await expect(SacLayout(STUDENT)).rejects.toThrow("NOT_FOUND");
  });

  test("404s a suspended SAC member (A3)", async () => {
    getSession.mockResolvedValue(session({ sacMember: true, suspended: true }));
    hasAnyBoothMembership.mockResolvedValue(false);
    await expect(SacLayout(STUDENT)).rejects.toThrow("NOT_FOUND");
  });

  test("admits a SAC member", async () => {
    getSession.mockResolvedValue(session({ sacMember: true }));
    hasAnyBoothMembership.mockResolvedValue(false);
    await expect(SacLayout(STUDENT)).resolves.toBeTruthy();
  });

  test("admits a SAC exec", async () => {
    getSession.mockResolvedValue(session({ sacExec: true }));
    hasAnyBoothMembership.mockResolvedValue(false);
    await expect(SacLayout(STUDENT)).resolves.toBeTruthy();
  });
});
