// src/lib/battle/result-format.ts のユニットテスト (#4-b、2026-05-25)
//
// 対象: 純関数 (BattleResult / supportsDraw / formatWLT / formatWLTJa /
//       resultLabel / winRate / winRateLabel / resultColorClass /
//       resultBgClass / bumpWLD)
// Supabase / 外部 API には接続しない。

import { describe, expect, it } from "vitest";

import {
  bumpWLD,
  formatWLT,
  formatWLTJa,
  resultBgClass,
  resultColorClass,
  resultLabel,
  supportsDraw,
  winRate,
  winRateLabel,
} from "./result-format";

describe("supportsDraw", () => {
  it("pokepoke では引き分けあり", () => {
    expect(supportsDraw("pokepoke")).toBe(true);
  });
  it("dm では引き分けなし", () => {
    expect(supportsDraw("dm")).toBe(false);
  });
  it("未知のゲームは引き分けなし扱い", () => {
    expect(supportsDraw("unknown")).toBe(false);
  });
});

describe("formatWLT", () => {
  it("dm は wins-losses 形式 (draws は表示しない)", () => {
    expect(formatWLT(5, 3, 1, "dm")).toBe("5-3");
  });
  it("pokepoke は wins-losses-draws 形式", () => {
    expect(formatWLT(5, 3, 1, "pokepoke")).toBe("5-3-1");
  });
  it("0 勝 0 敗でも文字列化される", () => {
    expect(formatWLT(0, 0, 0, "dm")).toBe("0-0");
  });
});

describe("formatWLTJa", () => {
  it("dm は 勝/敗 のみ", () => {
    expect(formatWLTJa(5, 3, 1, "dm")).toBe("5勝3敗");
  });
  it("pokepoke は 勝/敗/分", () => {
    expect(formatWLTJa(5, 3, 1, "pokepoke")).toBe("5勝3敗1分");
  });
});

describe("resultLabel", () => {
  it("win → 勝", () => {
    expect(resultLabel("win")).toBe("勝");
  });
  it("loss → 敗", () => {
    expect(resultLabel("loss")).toBe("敗");
  });
  it("draw → 分", () => {
    expect(resultLabel("draw")).toBe("分");
  });
});

describe("winRate", () => {
  it("基本ケース: 5 勝 5 敗 → 50", () => {
    expect(winRate(5, 5)).toBe(50);
  });
  it("全勝: 10 勝 0 敗 → 100", () => {
    expect(winRate(10, 0)).toBe(100);
  });
  it("全敗: 0 勝 10 敗 → 0", () => {
    expect(winRate(0, 10)).toBe(0);
  });
  it("分母 0 (0 勝 0 敗) → null", () => {
    expect(winRate(0, 0)).toBeNull();
  });
  it("小数点は四捨五入される (1 勝 2 敗 → 33)", () => {
    expect(winRate(1, 2)).toBe(33);
  });
  it("draws は計算対象外 (4 勝 1 敗 → 80、draws を無視)", () => {
    expect(winRate(4, 1)).toBe(80);
  });
});

describe("winRateLabel", () => {
  it("分母 0 は --%", () => {
    expect(winRateLabel(0, 0)).toBe("--%");
  });
  it("通常ケースは N% 形式", () => {
    expect(winRateLabel(5, 5)).toBe("50%");
  });
});

describe("resultColorClass", () => {
  it("win → text-success", () => {
    expect(resultColorClass("win")).toBe("text-success");
  });
  it("loss → text-destructive", () => {
    expect(resultColorClass("loss")).toBe("text-destructive");
  });
  it("draw → text-warning", () => {
    expect(resultColorClass("draw")).toBe("text-warning");
  });
});

describe("resultBgClass", () => {
  it("win → bg-success", () => {
    expect(resultBgClass("win")).toBe("bg-success");
  });
  it("loss → bg-destructive", () => {
    expect(resultBgClass("loss")).toBe("bg-destructive");
  });
  it("draw → bg-warning", () => {
    expect(resultBgClass("draw")).toBe("bg-warning");
  });
});

describe("bumpWLD", () => {
  it("win で wins を 1 増やす", () => {
    const obj = { wins: 0, losses: 0, draws: 0 };
    bumpWLD(obj, "win");
    expect(obj).toEqual({ wins: 1, losses: 0, draws: 0 });
  });
  it("loss で losses を 1 増やす", () => {
    const obj = { wins: 0, losses: 0, draws: 0 };
    bumpWLD(obj, "loss");
    expect(obj).toEqual({ wins: 0, losses: 1, draws: 0 });
  });
  it("draw で draws を 1 増やす", () => {
    const obj = { wins: 0, losses: 0, draws: 0 };
    bumpWLD(obj, "draw");
    expect(obj).toEqual({ wins: 0, losses: 0, draws: 1 });
  });
  it("累積動作 (win → win → loss)", () => {
    const obj = { wins: 0, losses: 0, draws: 0 };
    bumpWLD(obj, "win");
    bumpWLD(obj, "win");
    bumpWLD(obj, "loss");
    expect(obj).toEqual({ wins: 2, losses: 1, draws: 0 });
  });
});
