// 統計 RPC の row 型 → アプリ内 OpponentDetail 型 への純関数変換ヘルパー。
//
// #4-a refactor (2026-05-25) で `src/lib/actions/stats-actions.ts` から抽出。
// stats-actions.ts は DB I/O 層、本ファイルは純関数層として分離する。
// 循環依存回避のため、本ファイル (src/lib/stats/) から src/lib/actions/ への
// import は禁止 (plan §Resolved Decisions [stats helper場所] 参照)。
//
// 抽出元の経緯コメント (stats-actions.ts より):
// auto-gen 型は bigint → number / numeric → number として宣言するが、runtime では
// numeric が string 化される可能性があるため toN / toWinRate で受けて Number() 変換
// (安全側 wrap)。

import { winRate } from "@/lib/battle/result-format";

/**
 * 個人/グローバル詳細 RPC の共通 row shape (mapDetailRow が受け取る形)。
 */
export type DetailRowBase = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  win_rate: number;
  first_wins: number;
  first_losses: number;
  first_draws: number;
  first_total: number;
  second_wins: number;
  second_losses: number;
  second_draws: number;
  second_total: number;
  unknown_wins: number;
  unknown_losses: number;
  unknown_draws: number;
  unknown_total: number;
};

/**
 * deck/opponent 詳細 RPC の row shape (rowToDetail が受け取る形)。
 * DetailRowBase と異なり、draws が null 許容 / win_rate なし / opponent_name / my_deck_name / tuning_name 可選あり。
 */
export type DetailRpcRow = {
  opponent_name?: string;
  my_deck_name?: string;
  wins: number; losses: number; draws: number | null; total: number;
  first_wins: number; first_losses: number; first_draws: number | null; first_total: number;
  second_wins: number; second_losses: number; second_draws: number | null; second_total: number;
  unknown_wins: number; unknown_losses: number; unknown_draws: number | null; unknown_total: number;
  tuning_name?: string;
};

/**
 * アプリ内で扱う対面詳細統計のキャメルケース形。
 * UI コンポーネント (MatchupTable / MatchupCard 等) からも参照する公開型。
 */
export type OpponentDetail = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number | null;
  firstWins: number;
  firstLosses: number;
  firstDraws: number;
  firstTotal: number;
  firstWinRate: number | null;
  secondWins: number;
  secondLosses: number;
  secondDraws: number;
  secondTotal: number;
  secondWinRate: number | null;
  unknownWins: number;
  unknownLosses: number;
  unknownDraws: number;
  unknownTotal: number;
  unknownWinRate: number | null;
};

/**
 * null / undefined を 0、string を Number() 変換する安全 wrap。
 * RPC が numeric を string 化して返す可能性に対応。
 */
export const toN = (v: number | string | null | undefined): number =>
  v == null ? 0 : Number(v);

/**
 * null / undefined を null として保持、それ以外を Number() 変換する安全 wrap。
 * 勝率は null を「未計算」として UI 側で扱うため、明示 null 化が必要。
 */
export const toWinRate = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/**
 * DetailRowBase (RPC の row) を OpponentDetail (アプリ内型) に変換。
 * 個人統計の opponent_deck 軸 RPC で使用される。
 */
export const mapDetailRow = (r: DetailRowBase): OpponentDetail => ({
  wins: toN(r.wins),
  losses: toN(r.losses),
  draws: toN(r.draws),
  total: toN(r.total),
  winRate: toWinRate(r.win_rate),
  firstWins: toN(r.first_wins),
  firstLosses: toN(r.first_losses),
  firstDraws: toN(r.first_draws),
  firstTotal: toN(r.first_total),
  firstWinRate: winRate(toN(r.first_wins), toN(r.first_losses)),
  secondWins: toN(r.second_wins),
  secondLosses: toN(r.second_losses),
  secondDraws: toN(r.second_draws),
  secondTotal: toN(r.second_total),
  secondWinRate: winRate(toN(r.second_wins), toN(r.second_losses)),
  unknownWins: toN(r.unknown_wins),
  unknownLosses: toN(r.unknown_losses),
  unknownDraws: toN(r.unknown_draws),
  unknownTotal: toN(r.unknown_total),
  unknownWinRate: winRate(toN(r.unknown_wins), toN(r.unknown_losses)),
});

/**
 * DetailRpcRow (RPC の row、draws nullable) を OpponentDetail に変換。
 * deck/opponent 詳細統計 RPC で使用される。
 */
export const rowToDetail = (r: DetailRpcRow): OpponentDetail => {
  const w = Number(r.wins); const l = Number(r.losses); const d = Number(r.draws ?? 0); const t = Number(r.total);
  const fw = Number(r.first_wins); const fl = Number(r.first_losses); const fd = Number(r.first_draws ?? 0); const ft = Number(r.first_total);
  const sw = Number(r.second_wins); const sl = Number(r.second_losses); const sd = Number(r.second_draws ?? 0); const st = Number(r.second_total);
  const uw = Number(r.unknown_wins); const ul = Number(r.unknown_losses); const ud = Number(r.unknown_draws ?? 0); const ut = Number(r.unknown_total);
  return {
    wins: w, losses: l, draws: d, total: t, winRate: winRate(w, l),
    firstWins: fw, firstLosses: fl, firstDraws: fd, firstTotal: ft, firstWinRate: winRate(fw, fl),
    secondWins: sw, secondLosses: sl, secondDraws: sd, secondTotal: st, secondWinRate: winRate(sw, sl),
    unknownWins: uw, unknownLosses: ul, unknownDraws: ud, unknownTotal: ut, unknownWinRate: winRate(uw, ul),
  };
};
