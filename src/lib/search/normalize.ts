/**
 * 検索用文字列正規化 helper。
 *
 * NFKC → lowercase → ひらがなをカタカナに変換することで、
 * 「ガイア」「ｶﾞｲｱ」「がいあ」「Gaia」が同一比較対象になる。
 *
 * もともと `src/components/battle/OpponentDeckSelector.tsx` 内に
 * ローカル定義されていたものを共通化したもの。デッキ管理画面の
 * 検索 (dm/pokepoke `DeckList.tsx`) と対面デッキ検索で挙動を揃える。
 */
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/**
 * `query` が `candidates` のいずれかに includes するかをチェック。
 *
 * candidates には 1 件のアイテムにつき複数の検索対象文字列を渡せる
 * (例: 英語名 + 日本語表示名)。dm DeckList は `[name]` のみ、
 * pokepoke DeckList と OpponentDeckSelector は `[name, display(name)]` を渡す。
 *
 * 空クエリは true を返す (フィルタなしと同じ挙動)。
 */
export function matchesQuery(
  query: string,
  candidates: ReadonlyArray<string>,
): boolean {
  if (!query) return true;
  const q = normalizeQuery(query);
  return candidates.some((s) => normalizeQuery(s).includes(q));
}
