// src/lib/util/whitespace.ts のユニットテスト (#4-b、2026-05-25)
//
// 対象: stripAllWhitespace
// 目的: DB 側 CHECK 制約 `'[[:space:]　​-‍﻿]'` と TS 側 sanitizer の
//       パターン一致を保証する回帰テスト (cleanup / CHECK のパターン不一致による
//       migration 失敗を防止)。
//
// 注意: 直接 TS で zero-width 文字を書くと editor でわかりにくいため、
//       hexcode で comment を付ける形にしている。

import { describe, expect, it } from "vitest";

import { stripAllWhitespace } from "./whitespace";

describe("stripAllWhitespace", () => {
  describe("ASCII whitespace", () => {
    it("半角スペースを除去", () => {
      expect(stripAllWhitespace("hello world")).toBe("helloworld");
    });
    it("タブを除去", () => {
      expect(stripAllWhitespace("a\tb")).toBe("ab");
    });
    it("改行を除去", () => {
      expect(stripAllWhitespace("a\nb")).toBe("ab");
    });
    it("CR を除去", () => {
      expect(stripAllWhitespace("a\rb")).toBe("ab");
    });
    it("複数種類が混在", () => {
      expect(stripAllWhitespace("a \t\n b")).toBe("ab");
    });
  });

  describe("Unicode whitespace", () => {
    it("U+3000 全角スペース を除去", () => {
      expect(stripAllWhitespace("デ　ッキ")).toBe("デッキ");
    });
    it("U+200B zero-width space を除去", () => {
      expect(stripAllWhitespace("a​b")).toBe("ab");
    });
    it("U+200C zero-width non-joiner を除去", () => {
      expect(stripAllWhitespace("a‌b")).toBe("ab");
    });
    it("U+200D zero-width joiner を除去", () => {
      expect(stripAllWhitespace("a‍b")).toBe("ab");
    });
    it("U+FEFF BOM を除去", () => {
      expect(stripAllWhitespace("a﻿b")).toBe("ab");
    });
  });

  describe("空・空白のみ・通常文字列", () => {
    it("空文字はそのまま", () => {
      expect(stripAllWhitespace("")).toBe("");
    });
    it("空白のみの文字列は空文字になる", () => {
      expect(stripAllWhitespace("   \t\n  　")).toBe("");
    });
    it("空白を含まない文字列は変化なし", () => {
      expect(stripAllWhitespace("デッキ名称")).toBe("デッキ名称");
    });
    it("日本語・英数字混在", () => {
      expect(stripAllWhitespace("ABC デ ッ キ 123")).toBe("ABCデッキ123");
    });
  });

  describe("DB CHECK 制約との一致確認", () => {
    // DB 側の CHECK 制約は `'[[:space:]　​-‍﻿]'` で同範囲をカバーする想定。
    // 以下のような文字列が DB から弾かれるべきものは、TS 側でも空白除去後に空に
    // なる (空名扱いで弾かれる) ことを確認。
    it("全角スペースのみは空に正規化される", () => {
      expect(stripAllWhitespace("　　")).toBe("");
    });
    it("zero-width 系のみは空に正規化される", () => {
      expect(stripAllWhitespace("​‌‍﻿")).toBe("");
    });
  });
});
