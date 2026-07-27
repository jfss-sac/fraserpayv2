import { render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { LeaderboardDTO } from "@/lib/shared/types";

const { getSession, redirect, getLeaderboard, viewProps } = vi.hoisted(() => ({
  getSession: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  getLeaderboard: vi.fn(),
  viewProps: { current: null as unknown },
}));

vi.mock("@/lib/server/dal", () => ({ getSession }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/server/leaderboard", () => ({ getLeaderboard }));
vi.mock("./leaderboard-view", () => ({
  LeaderboardView: (props: unknown) => {
    viewProps.current = props;
    return null;
  },
}));

import LeaderboardPage from "./page";

const DATA: LeaderboardDTO = {
  rows: [{ rank: 1, boothId: "b1", boothName: "Ring Toss", grossCents: 4000 }],
};

beforeEach(() => {
  getSession.mockReset();
  redirect.mockClear();
  getLeaderboard.mockReset();
  getLeaderboard.mockResolvedValue(DATA);
  viewProps.current = null;
});

test("redirects a signed-out visitor to /login", async () => {
  getSession.mockResolvedValue(null);
  await expect(LeaderboardPage()).rejects.toThrow("REDIRECT:/login");
  expect(getLeaderboard).not.toHaveBeenCalled();
});

test("renders the leaderboard for any authenticated user", async () => {
  getSession.mockResolvedValue({ uid: "u1", roles: { sacMember: false, sacExec: false } });
  render(await LeaderboardPage());
  expect(redirect).not.toHaveBeenCalled();
  expect(viewProps.current).toEqual({ data: DATA });
});
