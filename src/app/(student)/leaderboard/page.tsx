import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leaderboard",
};

export default function LeaderboardPage() {
  return <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>;
}
