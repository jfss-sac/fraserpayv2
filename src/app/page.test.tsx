import { beforeEach, expect, test, vi } from "vitest";

const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession }));
vi.mock("next/navigation", () => ({ redirect }));

import Home from "@/app/page";

beforeEach(() => {
  getSession.mockReset();
  redirect.mockClear();
});

test("landing sends an unauthenticated visitor to /login", async () => {
  getSession.mockResolvedValue(null);
  await expect(Home()).rejects.toThrow("REDIRECT:/login");
});

test("landing sends an authenticated visitor to the wallet by default", async () => {
  getSession.mockResolvedValue({ uid: "u1" });
  await expect(Home()).rejects.toThrow("REDIRECT:/wallet");
});
