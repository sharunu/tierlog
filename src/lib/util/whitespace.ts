/**
 * 文字列から空白文字を全削除する sanitizer。
 *
 * 対象集合 (DB 側 CHECK 制約 `'[[:space:]　​-‍﻿]'` と同じ意味):
 *   - ASCII whitespace (`\s` = space, tab, newline, CR, FF, VT)
 *   - U+3000 全角スペース
 *   - U+200B〜U+200D zero-width space / non-joiner / joiner
 *   - U+FEFF BOM
 *
 * V8 の `\s` は U+3000 を含むが、SQL POSIX `[[:space:]]` は含まないため、
 * TS 側でも明示列挙して DB 側パターンと完全に揃える (cleanup と CHECK の
 * パターン不一致による migration 失敗を防止)。
 *
 * 戻り値が空文字になるケース (入力が空白のみ) は呼び出し側で「空名前エラー」
 * として弾く想定 (`deck-actions.ts` の createDeck/updateDeck がその役)。
 */
export function stripAllWhitespace(s: string): string {
  return s.replace(/[\s　​-‍﻿]/g, "");
}
