// src/lib/games/index.ts のユニットテスト (#4-b、2026-05-25)
//
// 対象: ゲームレジストリ (GAMES / GAME_SLUGS / DEFAULT_GAME / APP_BRAND) と
//       純関数 (isGameSlug / resolveGameFromPath / getGameMeta)。
// Supabase / 外部 API には接続しない。
//
// テスト方針:
// 新規ゲーム追加時の運用ルール (CLAUDE.md「マルチゲーム対応設計」) と整合:
// - format コードがゲーム間で重複しないこと
// - DEFAULT_GAME がレジストリに含まれること
// - isGameSlug が型ガードとして正しく機能すること

import { describe, expect, it } from "vitest";

import {
  APP_BRAND,
  DEFAULT_GAME,
  GAME_SLUGS,
  GAMES,
  getGameMeta,
  isGameSlug,
  resolveGameFromPath,
} from "./index";

describe("GAMES registry", () => {
  it("dm と pokepoke が登録済み", () => {
    expect(GAMES.dm).toBeDefined();
    expect(GAMES.pokepoke).toBeDefined();
  });
  it("各 GameMeta が必須プロパティを持つ", () => {
    for (const meta of Object.values(GAMES)) {
      expect(meta.slug).toBeTruthy();
      expect(meta.displayName).toBeTruthy();
      expect(meta.shortName).toBeTruthy();
      expect(meta.trackerName).toBeTruthy();
      expect(Array.isArray(meta.formats)).toBe(true);
    }
  });
  it("format コードがゲーム間で重複しない (マルチゲーム対応の前提)", () => {
    const allCodes: string[] = [];
    for (const meta of Object.values(GAMES)) {
      for (const fmt of meta.formats) {
        allCodes.push(fmt.code);
      }
    }
    const unique = new Set(allCodes);
    expect(unique.size).toBe(allCodes.length);
  });
});

describe("GAME_SLUGS / DEFAULT_GAME", () => {
  it("GAME_SLUGS は GAMES のキー", () => {
    expect(GAME_SLUGS.sort()).toEqual(["dm", "pokepoke"].sort());
  });
  it("DEFAULT_GAME は GAME_SLUGS に含まれる", () => {
    expect(GAME_SLUGS).toContain(DEFAULT_GAME);
  });
});

describe("APP_BRAND", () => {
  it("ブランド名は Tierlog", () => {
    expect(APP_BRAND.name).toBe("Tierlog");
  });
});

describe("isGameSlug", () => {
  it("'dm' / 'pokepoke' は true", () => {
    expect(isGameSlug("dm")).toBe(true);
    expect(isGameSlug("pokepoke")).toBe(true);
  });
  it("未知の文字列は false", () => {
    expect(isGameSlug("unknown")).toBe(false);
    expect(isGameSlug("DM")).toBe(false);
    expect(isGameSlug("")).toBe(false);
  });
  it("null / undefined は false", () => {
    expect(isGameSlug(null)).toBe(false);
    expect(isGameSlug(undefined)).toBe(false);
  });
});

describe("resolveGameFromPath", () => {
  it("/dm/home → dm", () => {
    expect(resolveGameFromPath("/dm/home")).toBe("dm");
  });
  it("/pokepoke/battle → pokepoke", () => {
    expect(resolveGameFromPath("/pokepoke/battle")).toBe("pokepoke");
  });
  it("/account → null (game 非依存ページ)", () => {
    expect(resolveGameFromPath("/account")).toBeNull();
  });
  it("/admin → null", () => {
    expect(resolveGameFromPath("/admin")).toBeNull();
  });
  it("'/' (root) → null", () => {
    expect(resolveGameFromPath("/")).toBeNull();
  });
  it("空文字 → null", () => {
    expect(resolveGameFromPath("")).toBeNull();
  });
  it("null / undefined → null", () => {
    expect(resolveGameFromPath(null)).toBeNull();
    expect(resolveGameFromPath(undefined)).toBeNull();
  });
  it("/unknown/foo → null (未登録ゲームの prefix)", () => {
    expect(resolveGameFromPath("/unknown/foo")).toBeNull();
  });
});

describe("getGameMeta", () => {
  it("dm の slug が正しく取れる", () => {
    expect(getGameMeta("dm").slug).toBe("dm");
  });
  it("pokepoke の displayName が取れる", () => {
    expect(getGameMeta("pokepoke").displayName).toContain("Pokémon");
  });
});
