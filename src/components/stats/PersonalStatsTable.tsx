"use client";

import { supportsDraw } from "@/lib/battle/result-format";

type StatRow = {
  deckName: string;
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number | null;
};

export function PersonalStatsTable({ stats, game }: { stats: StatRow[]; game: string }) {
  if (stats.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8 text-sm">
        対戦データがありません
      </p>
    );
  }

  const showDraws = supportsDraw(game);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="pb-2 pr-4">対面デッキ</th>
            <th className="pb-2 px-2 text-center">勝率</th>
            <th className="pb-2 px-2 text-center">W</th>
            <th className="pb-2 px-2 text-center">L</th>
            {showDraws && <th className="pb-2 px-2 text-center">D</th>}
            <th className="pb-2 pl-2 text-center">計</th>
          </tr>
        </thead>
        <tbody>
          {stats.map((row) => {
            const ratePct = row.winRate;
            const ratePositive = ratePct !== null && ratePct >= 50;
            return (
              <tr key={row.deckName} className="border-b border-border/50">
                <td className="py-2 pr-4">{row.deckName}</td>
                <td className="py-2 px-2 text-center">
                  <span
                    className={
                      ratePct === null
                        ? "text-muted-foreground"
                        : ratePositive
                          ? "text-success"
                          : "text-destructive"
                    }
                  >
                    {ratePct === null ? "--" : `${Math.round((ratePct as number))}`}%
                  </span>
                </td>
                <td className="py-2 px-2 text-center text-success">
                  {row.wins}
                </td>
                <td className="py-2 px-2 text-center text-destructive">
                  {row.losses}
                </td>
                {showDraws && (
                  <td className="py-2 px-2 text-center text-warning">
                    {row.draws}
                  </td>
                )}
                <td className="py-2 pl-2 text-center text-muted-foreground">
                  {row.total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
