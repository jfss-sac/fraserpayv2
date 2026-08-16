import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const { getSession, redirect } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/server/dal", () => ({ getSession }));
vi.mock("@/lib/server/site", () => ({ SITE_NAME: "FraserPay" }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/ui/sign-out-button", () => ({ SignOutButton: () => <button>Sign out</button> }));
vi.mock("./register-form", () => ({
  BoothRegisterForm: ({ actorUid }: { actorUid: string }) => (
    <div data-testid="request-booth-form" data-actor-uid={actorUid} />
  ),
}));

import RequestBoothPage from "./page";

beforeEach(() => {
  getSession.mockReset();
  redirect.mockClear();
});

test("redirects an unauthenticated visitor to /login", async () => {
  getSession.mockResolvedValue(null);

  await expect(RequestBoothPage()).rejects.toThrow("REDIRECT:/login");
});

test("renders the standalone request page with the session uid", async () => {
  getSession.mockResolvedValue({ uid: "teacher-1" });

  render(await RequestBoothPage());

  expect(screen.getByRole("heading", { name: "Request a booth" })).toBeInTheDocument();
  expect(screen.getByTestId("request-booth-form")).toBeInTheDocument();
  expect(document.querySelector('[data-actor-uid="teacher-1"]')).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "FraserPay" })).toHaveAttribute("href", "/wallet");
});
