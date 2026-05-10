"use client";

import { getWinRateColor } from "@/lib/stats-utils";
import { formatWLTJa, winRate as computeWinRate } from "@/lib/battle/result-format";

type TurnOrderCardsProps = {
  firstWins: number; firstLosses: number; firstDraws: number; firstTotal: number;
  secondWins: number; secondLosses: number; secondDraws: number; secondTotal: number;
  unknownWins: number; unknownLosses: number; unknownDraws: number; unknownTotal: number;
  game: string;
};

type CardSpec = {
  label: string;
  labelClass: string;
  borderClass: string;
  wins: number;
  losses: number;
  draws: number;
  total: number;
};

export function TurnOrderCards(props: TurnOrderCardsProps) {
  const cards: CardSpec[] = [
    {
      label: "先攻",
      labelClass: "text-warning",
      borderClass: "border-warning",
      wins: props.firstWins, losses: props.firstLosses, draws: props.firstDraws, total: props.firstTotal,
    },
    {
      label: "後攻",
      labelClass: "text-primary",
      borderClass: "border-primary",
      wins: props.secondWins, losses: props.secondLosses, draws: props.secondDraws, total: props.secondTotal,
    },
    {
      label: "不明",
      labelClass: "text-muted-foreground",
      borderClass: "border-muted-foreground",
      wins: props.unknownWins, losses: props.unknownLosses, draws: props.unknownDraws, total: props.unknownTotal,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-1.5">
      {cards.map((c) => {
        const rate = computeWinRate(c.wins, c.losses);
        return (
          <div
            key={c.label}
            className={`bg-surface-2 rounded-lg p-2.5 text-center border-t-2 ${c.borderClass}`}
          >
            <div className={`text-[10px] font-medium ${c.labelClass}`}>{c.label}</div>
            <div className="flex items-baseline justify-center gap-0.5">
              <span className="text-[10px] text-muted-foreground">勝率</span>
              <span className="text-xl font-medium" style={{ color: getWinRateColor(rate) }}>
                {rate !== null ? `${rate}%` : "--%"}
              </span>
            </div>
            <div className="text-[9px] text-muted-foreground">
              {c.total > 0 ? `${formatWLTJa(c.wins, c.losses, c.draws, props.game)} / ${c.total}件` : "0件"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
