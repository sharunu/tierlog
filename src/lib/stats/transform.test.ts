// src/lib/stats/transform.ts のユニットテスト (#4-b、2026-05-25)
//
// 対象: 純関数 helper (toN / toWinRate / mapDetailRow / rowToDetail)
// 目的: #4-a で抽出した RPC row → OpponentDetail 変換ロジックの回帰防止。
//       特に numeric 型が string で渡るケース (Supabase の auto-gen 型仕様)、
//       null / undefined 入力時の安全側 fallback を網羅。

import { describe, expect, it } from "vitest";

import { mapDetailRow, rowToDetail, toN, toWinRate } from "./transform";
import type { DetailRowBase, DetailRpcRow } from "./transform";

describe("toN", () => {
  it("number は そのまま", () => {
    expect(toN(5)).toBe(5);
    expect(toN(0)).toBe(0);
  });
  it("string は Number() で変換", () => {
    expect(toN("10")).toBe(10);
    expect(toN("0")).toBe(0);
  });
  it("null → 0", () => {
    expect(toN(null)).toBe(0);
  });
  it("undefined → 0", () => {
    expect(toN(undefined)).toBe(0);
  });
  it("小数 string も Number() 変換", () => {
    expect(toN("3.14")).toBeCloseTo(3.14);
  });
});

describe("toWinRate", () => {
  it("number は そのまま", () => {
    expect(toWinRate(50)).toBe(50);
    expect(toWinRate(100)).toBe(100);
    expect(toWinRate(0)).toBe(0);
  });
  it("string は Number() で変換", () => {
    expect(toWinRate("50.5")).toBeCloseTo(50.5);
  });
  it("null → null (toN と違って 0 にしない)", () => {
    expect(toWinRate(null)).toBeNull();
  });
  it("undefined → null", () => {
    expect(toWinRate(undefined)).toBeNull();
  });
});

describe("mapDetailRow", () => {
  const baseRow: DetailRowBase = {
    wins: 10,
    losses: 5,
    draws: 1,
    total: 16,
    win_rate: 67,
    first_wins: 6,
    first_losses: 2,
    first_draws: 0,
    first_total: 8,
    second_wins: 4,
    second_losses: 3,
    second_draws: 1,
    second_total: 8,
    unknown_wins: 0,
    unknown_losses: 0,
    unknown_draws: 0,
    unknown_total: 0,
  };

  it("number 入力で全フィールドが正しくマップされる", () => {
    const out = mapDetailRow(baseRow);
    expect(out.wins).toBe(10);
    expect(out.losses).toBe(5);
    expect(out.draws).toBe(1);
    expect(out.total).toBe(16);
    expect(out.winRate).toBe(67);
    expect(out.firstWins).toBe(6);
    expect(out.firstLosses).toBe(2);
    expect(out.firstDraws).toBe(0);
    expect(out.firstTotal).toBe(8);
    expect(out.firstWinRate).toBe(75); // 6 / (6+2) = 75
    expect(out.secondWins).toBe(4);
    expect(out.secondLosses).toBe(3);
    expect(out.secondTotal).toBe(8);
    expect(out.secondWinRate).toBe(57); // 4 / (4+3) ≈ 57
    expect(out.unknownTotal).toBe(0);
    expect(out.unknownWinRate).toBeNull(); // 分母 0
  });

  it("string で渡された numeric を Number() 変換する (auto-gen 型対応)", () => {
    const stringRow = {
      ...baseRow,
      wins: "10" as unknown as number,
      losses: "5" as unknown as number,
    };
    const out = mapDetailRow(stringRow as DetailRowBase);
    expect(out.wins).toBe(10);
    expect(out.losses).toBe(5);
  });

  it("win_rate が null/undefined の場合 winRate は null", () => {
    const nullRow = {
      ...baseRow,
      win_rate: null as unknown as number,
    };
    const out = mapDetailRow(nullRow as DetailRowBase);
    expect(out.winRate).toBeNull();
  });
});

describe("rowToDetail", () => {
  const baseRow: DetailRpcRow = {
    opponent_name: "テストデッキ",
    wins: 10,
    losses: 5,
    draws: 1,
    total: 16,
    first_wins: 6,
    first_losses: 2,
    first_draws: 0,
    first_total: 8,
    second_wins: 4,
    second_losses: 3,
    second_draws: 1,
    second_total: 8,
    unknown_wins: 0,
    unknown_losses: 0,
    unknown_draws: 0,
    unknown_total: 0,
  };

  it("number 入力で全フィールドが正しくマップされる (winRate は内部計算)", () => {
    const out = rowToDetail(baseRow);
    expect(out.wins).toBe(10);
    expect(out.losses).toBe(5);
    expect(out.draws).toBe(1);
    expect(out.total).toBe(16);
    expect(out.winRate).toBe(67); // 10 / (10+5) ≈ 67
    expect(out.firstWinRate).toBe(75); // 6 / 8
    expect(out.secondWinRate).toBe(57); // 4 / 7
    expect(out.unknownWinRate).toBeNull(); // 分母 0
  });

  it("draws が null の場合 0 として扱う", () => {
    const nullDrawsRow: DetailRpcRow = {
      ...baseRow,
      draws: null,
      first_draws: null,
      second_draws: null,
      unknown_draws: null,
    };
    const out = rowToDetail(nullDrawsRow);
    expect(out.draws).toBe(0);
    expect(out.firstDraws).toBe(0);
    expect(out.secondDraws).toBe(0);
    expect(out.unknownDraws).toBe(0);
  });

  it("string で渡された numeric を Number() 変換する", () => {
    const stringRow = {
      ...baseRow,
      wins: "10" as unknown as number,
      losses: "5" as unknown as number,
    };
    const out = rowToDetail(stringRow as DetailRpcRow);
    expect(out.wins).toBe(10);
    expect(out.losses).toBe(5);
    expect(out.winRate).toBe(67);
  });

  it("全カラム 0 の場合は winRate がすべて null", () => {
    const zeroRow: DetailRpcRow = {
      wins: 0,
      losses: 0,
      draws: 0,
      total: 0,
      first_wins: 0,
      first_losses: 0,
      first_draws: 0,
      first_total: 0,
      second_wins: 0,
      second_losses: 0,
      second_draws: 0,
      second_total: 0,
      unknown_wins: 0,
      unknown_losses: 0,
      unknown_draws: 0,
      unknown_total: 0,
    };
    const out = rowToDetail(zeroRow);
    expect(out.winRate).toBeNull();
    expect(out.firstWinRate).toBeNull();
    expect(out.secondWinRate).toBeNull();
    expect(out.unknownWinRate).toBeNull();
  });
});
