import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/dal";
import { getLeaderboard } from "@/lib/server/leaderboard";
import { LeaderboardView } from "./leaderboard-view";

export const metadata: Metadata = {
  title: "Leaderboard",
};

export default async function LeaderboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await getLeaderboard();
  return <LeaderboardView data={data} />;
}
