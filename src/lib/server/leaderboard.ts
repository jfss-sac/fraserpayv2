import "server-only";
import { unstable_cache } from "next/cache";
import { getBoothGrossCents } from "./dal";
import { boothsCol } from "./db";
import type { LeaderboardDTO } from "@/lib/shared/types";

export interface LeaderboardBooth {
  boothId: string;
  boothName: string;
  grossCents: number;
}

export function buildLeaderboard(booths: LeaderboardBooth[]): LeaderboardDTO {
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
  const booths = await Promise.all(
    ranked.map(async (doc) => ({
      boothId: doc.id,
      boothName: doc.data().name,
      grossCents: await getBoothGrossCents(doc.id),
    })),
  );
  return buildLeaderboard(booths);
}

export const getLeaderboard = unstable_cache(computeLeaderboard, ["leaderboard"], {
  revalidate: 900,
});
