import { formatCents } from "@/lib/shared/money";
import type { LeaderboardDTO } from "@/lib/shared/types";

export function LeaderboardView({ data }: { data: LeaderboardDTO }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Leaderboard</h1>
        <p className="text-sm text-muted">Booths ranked by gross sales · updated ~every 15 min.</p>
      </div>

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted">No sales yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {data.rows.map((row) => (
            <li
              key={row.boothId}
              className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
            >
              <span className="flex items-center gap-3">
                <span className="w-6 text-right font-semibold tabular-nums text-muted">
                  {row.rank}
                </span>
                <span className="font-medium text-foreground">{row.boothName}</span>
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatCents(row.grossCents)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
