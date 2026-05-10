export type BattleResult = "win" | "loss" | "draw";

export const supportsDraw = (game: string) => game === "pokepoke";

export function formatWLT(
  wins: number,
  losses: number,
  draws: number,
  game: string,
): string {
  return supportsDraw(game)
    ? `${wins}-${losses}-${draws}`
    : `${wins}-${losses}`;
}

export function formatWLTJa(
  wins: number,
  losses: number,
  draws: number,
  game: string,
): string {
  return supportsDraw(game)
    ? `${wins}勝${losses}敗${draws}分`
    : `${wins}勝${losses}敗`;
}

export function resultLabel(result: BattleResult): "勝" | "敗" | "分" {
  return result === "win" ? "勝" : result === "loss" ? "敗" : "分";
}

// 勝率（%）を返す。分母0なら null。0-100 の整数（既存 safeRate と同じ仕様）
export function winRate(wins: number, losses: number): number | null {
  const denom = wins + losses;
  return denom === 0 ? null : Math.round((wins / denom) * 100);
}

export function winRateLabel(wins: number, losses: number): string {
  const r = winRate(wins, losses);
  return r === null ? "--%" : `${r}%`;
}

export function resultColorClass(result: BattleResult): string {
  return result === "win"
    ? "text-success"
    : result === "loss"
      ? "text-destructive"
      : "text-warning";
}

export function resultBgClass(result: BattleResult): string {
  return result === "win"
    ? "bg-success"
    : result === "loss"
      ? "bg-destructive"
      : "bg-warning";
}

// wins/losses/draws カウンタを result に応じてインクリメントする共通処理
export function bumpWLD(
  obj: { wins: number; losses: number; draws: number },
  result: BattleResult,
): void {
  if (result === "win") obj.wins++;
  else if (result === "loss") obj.losses++;
  else obj.draws++;
}
