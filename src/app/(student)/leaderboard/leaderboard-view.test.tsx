import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import type { LeaderboardDTO } from "@/lib/shared/types";
import { LeaderboardView } from "./leaderboard-view";

const DATA: LeaderboardDTO = {
  rows: [
    { rank: 1, boothId: "b1", boothName: "Ring Toss", grossCents: 4000 },
    { rank: 2, boothId: "b2", boothName: "Bake Sale", grossCents: 1500 },
  ],
};

test("shows rank, booth name, and gross with the 15-minute cadence note", () => {
  render(<LeaderboardView data={DATA} />);

  expect(screen.getByText(/updated ~every 15 min/i)).toBeInTheDocument();

  const items = screen.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("1");
  expect(items[0]).toHaveTextContent("Ring Toss");
  expect(items[0]).toHaveTextContent("$40.00");
  expect(items[1]).toHaveTextContent("Bake Sale");
  expect(items[1]).toHaveTextContent("$15.00");
});

test("renders an empty state when there are no sales", () => {
  render(<LeaderboardView data={{ rows: [] }} />);
  expect(screen.getByText("No sales yet.")).toBeInTheDocument();
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
});
