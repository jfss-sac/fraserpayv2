import { beforeEach, expect, test, vi } from "vitest";

const { permanentRedirect } = vi.hoisted(() => ({
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`PERMANENT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({ permanentRedirect }));

import BoothRegisterPage from "./page";

beforeEach(() => {
  permanentRedirect.mockClear();
});

test("permanently redirects the retired registration route", () => {
  expect(() => BoothRegisterPage()).toThrow("PERMANENT_REDIRECT:/request-booth");
  expect(permanentRedirect).toHaveBeenCalledWith("/request-booth");
});
