import "server-only";
import { unstable_cache } from "next/cache";
import { getBoothSummary } from "./dal";
import { boothsCol } from "./db";
import type { BoothSummary, LeaderboardDTO } from "@/lib/shared/types";

export function buildLeaderboard(booths: BoothSummary[]): LeaderboardDTO {
  const rows = [...booths]
    .sort((a, b) => b.grossCents - a.grossCents || a.boothName.localeCompare(b.boothName))
    .map((booth, index) => ({
      rank: index + 1,
      boothId: booth.boothId,
      boothName: booth.boothName,
      grossCents: booth.grossCents,
    }));
  return { rows };
}

export async function computeLeaderboard(): Promise<LeaderboardDTO> {
  const boothSnap = await boothsCol().get();
  const ranked = boothSnap.docs.filter((doc) => doc.data().status !== "pending");
  const summaries = await Promise.all(ranked.map((doc) => getBoothSummary(doc.id)));
  const booths = summaries.filter((summary): summary is BoothSummary => summary !== null);
  return buildLeaderboard(booths);
}

export const getLeaderboard = unstable_cache(computeLeaderboard, ["leaderboard"], {
  revalidate: 900,
});
