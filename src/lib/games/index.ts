/**
 * ゲームタイトル・レジストリ
 * 新規ゲーム追加時はここに GameMeta を追加するだけで OK。
 */

export type GameSlug = "dm" | "pokepoke";

export type FormatOption = {
  code: string;
  label: string;
};

export type GameMeta = {
  slug: GameSlug;
  displayName: string;  // 公式表記
  shortName: string;    // 短縮
  trackerName: string;  // 「Tierlog - デュエプレ」など
  description: string;
  formats: readonly FormatOption[]; // 空配列なら FormatSelector 非表示
  defaultFormat: string | null;
};

export const GAMES: Record<GameSlug, GameMeta> = {
  dm: {
    slug: "dm",
    displayName: "デュエル・マスターズ プレイス",
    shortName: "デュエプレ",
    trackerName: "Tierlog - デュエプレ",
    description: "デュエル・マスターズ プレイスの対戦記録・環境分析ツール",
    formats: [
      { code: "ND", label: "ND" },
      { code: "AD", label: "AD" },
    ],
    defaultFormat: "ND",
  },
  pokepoke: {
    slug: "pokepoke",
    displayName: "Pokémon Trading Card Game Pocket",
    shortName: "ポケポケ",
    trackerName: "Tierlog - ポケポケ",
    description: "Pokémon Trading Card Game Pocket の対戦記録・環境分析ツール",
    formats: [
      { code: "RANKED", label: "ランクマッチ" },
      { code: "RANDOM", label: "ランダムマッチ" },
    ],
    defaultFormat: "RANKED",
  },
};

export const GAME_SLUGS = Object.keys(GAMES) as GameSlug[];
export const DEFAULT_GAME: GameSlug = "dm";

export const APP_BRAND = {
  name: "Tierlog",
  description: "各ゲームの対戦記録・環境分析ツール",
};

export function isGameSlug(value: string | null | undefined): value is GameSlug {
  return typeof value === "string" && (GAME_SLUGS as string[]).includes(value);
}

export function resolveGameFromPath(pathname: string | null | undefined): GameSlug | null {
  if (!pathname) return null;
  const first = pathname.split("/").filter(Boolean)[0];
  return isGameSlug(first) ? first : null;
}

export function getGameMeta(slug: GameSlug): GameMeta {
  return GAMES[slug];
}
