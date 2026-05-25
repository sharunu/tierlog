// src/lib/search/normalize.ts のユニットテスト (#4-b、2026-05-25)
//
// 対象: normalizeQuery / matchesQuery
// 目的: 検索フィルタの正規化挙動 (NFKC + lowercase + ひらがな→カタカナ) を
//       deck 名検索 (dm/pokepoke DeckList / OpponentDeckSelector) で
//       回帰なく動作することを保証。

import { describe, expect, it } from "vitest";

import { matchesQuery, normalizeQuery } from "./normalize";

describe("normalizeQuery", () => {
  describe("NFKC 正規化", () => {
    it("半角カナを全角カナに正規化", () => {
      expect(normalizeQuery("ｶﾞｲｱ")).toBe("ガイア");
    });
    it("全角英数字を半角に正規化", () => {
      expect(normalizeQuery("ＡＢＣ123")).toBe("abc123");
    });
  });

  describe("lowercase", () => {
    it("大文字 → 小文字", () => {
      expect(normalizeQuery("ABC")).toBe("abc");
    });
    it("混在", () => {
      expect(normalizeQuery("aBcD")).toBe("abcd");
    });
  });

  describe("ひらがな → カタカナ", () => {
    it("ひらがな完全一致", () => {
      expect(normalizeQuery("がいあ")).toBe("ガイア");
    });
    it("ひらがな + カタカナ混在", () => {
      expect(normalizeQuery("ガがイいア")).toBe("ガガイイア");
    });
    it("濁音・半濁音もカタカナに", () => {
      expect(normalizeQuery("ばぱ")).toBe("バパ");
    });
  });

  describe("組み合わせケース", () => {
    it("全角英数字 + ひらがな + 大文字", () => {
      expect(normalizeQuery("Ｇａｉａがいあ")).toBe("gaiaガイア");
    });
    it("半角カナ + ひらがな", () => {
      expect(normalizeQuery("ｶﾞイあ")).toBe("ガイア");
    });
  });

  describe("空・特殊", () => {
    it("空文字はそのまま", () => {
      expect(normalizeQuery("")).toBe("");
    });
    it("数字のみ", () => {
      expect(normalizeQuery("123")).toBe("123");
    });
  });
});

describe("matchesQuery", () => {
  describe("基本動作", () => {
    it("完全一致", () => {
      expect(matchesQuery("ガイア", ["ガイア"])).toBe(true);
    });
    it("部分一致", () => {
      expect(matchesQuery("ガイア", ["ガイアウォール"])).toBe(true);
    });
    it("不一致", () => {
      expect(matchesQuery("ガイア", ["ボルバルザーク"])).toBe(false);
    });
  });

  describe("空クエリ", () => {
    it("空クエリは候補すべてマッチ (フィルタなし)", () => {
      expect(matchesQuery("", ["ガイア"])).toBe(true);
      expect(matchesQuery("", [])).toBe(true);
    });
  });

  describe("正規化を経た一致", () => {
    it("ひらがなで検索 → カタカナ候補にヒット", () => {
      expect(matchesQuery("がいあ", ["ガイアウォール"])).toBe(true);
    });
    it("半角カナで検索 → 全角カナ候補にヒット", () => {
      expect(matchesQuery("ｶﾞｲｱ", ["ガイアウォール"])).toBe(true);
    });
    it("大文字で検索 → 小文字候補にヒット", () => {
      expect(matchesQuery("GAIA", ["gaia control"])).toBe(true);
    });
  });

  describe("複数候補", () => {
    it("いずれかの候補に一致すれば true", () => {
      expect(matchesQuery("gaia", ["他のデッキ", "Gaia Control", "別物"])).toBe(true);
    });
    it("どの候補にも一致しなければ false", () => {
      expect(matchesQuery("gaia", ["別のデッキ", "違うやつ"])).toBe(false);
    });
  });

  describe("候補が空配列", () => {
    it("候補なしで非空クエリ → false", () => {
      expect(matchesQuery("ガイア", [])).toBe(false);
    });
  });
});
