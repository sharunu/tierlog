# 2026-05-18: デッキ管理改善 + 期間指定保存 + 注意書き変更

## 1. 概要 / 目的

「使用デッキ管理」「分析」「対戦記録」周りの 5 件の改修をまとめて 1 PR で実施する。

1. デッキ管理画面の検索を「対戦記録の対面デッキ検索」と同等の正規化 (ひらがな⇄カタカナ) に揃える
2. デッキ名から**全空白**を恒久的に排除し、UI / Server actions / DB の三層で防御する
3. 既存 DB の `decks.name` / `battles.my_deck_name` から空白を削除し、内部空白で分かれていた重複デッキを統合する
4. 「分析」「対戦記録履歴」の期間指定の**開始日 (start) をゲーム別に localStorage 保存**して引き継ぐ
5. 「使用デッキ管理」の注意書き文言を共有先が分かる文に変更する

これにより、ユーザーが「ガイアッシュカイザー」/「ｶﾞｲｱｯｼｭｶｲｻﾞｰ」/「ガイ アッシュ カイザー」のような表記揺れで検索ミス・重複登録するケースを根絶し、期間設定の繰り返し操作を不要にする。

## 2. スコープ

### 含む
- 使用デッキ管理 (dm/pokepoke) の検索フィルタ正規化
- `decks.name` / `battles.my_deck_name` の全空白削除・重複統合 (UI 入力 / Server actions / DB migration / CHECK 制約)
- PlayLimitless 取り込みの `name_ja` のみ空白削除
- `handle_new_user()` (SQL) の更新
- 分析タブ全画面 (一覧 + 詳細) + 対戦記録の履歴タブ の期間開始日のゲーム別 localStorage 保存
- 使用デッキ管理画面の注意書き文言変更 (dm/pokepoke 両方)

### 含まない (scope 外)
- チューニング名 (`deck_tunings.name`) — 空白許容のまま、CHECK 制約も追加しない
- 対面デッキ名 (`opponent_deck_master.name` / `name_en` / `name_ja` / `battles.opponent_deck_name`) — Limitless 内部キーと整合する必要があるため
- 管理画面 (`AdminUserStats.tsx` / `AdminUserBattles.tsx`) の期間指定共通化
- 期間の **終了日** の localStorage 保存 (URL > 今日 のまま)
- 注意書きの共通コンポーネント化
- §13 に列挙する既存課題 (別 PR)

## 3. 影響範囲ファイル一覧

### 3.1 新規追加
- `src/lib/search/normalize.ts` — 検索正規化 helper
- `src/lib/util/whitespace.ts` — 空白削除 sanitizer
- `src/hooks/use-date-range.ts` — 期間指定共通 hook (URL + localStorage + default)
- `supabase/migrations/<timestamp>_decks_strip_whitespace_and_dedupe.sql` — DB 統合 + CHECK 追加 + handle_new_user 更新
- `docs/reports/2026-05-18_deck_search_sanitize_date_range.md` — 実装後の報告書 (実装時に作成)

### 3.2 編集
- `src/components/battle/OpponentDeckSelector.tsx` — `normalizeQuery` のローカル定義を撤去し共通 helper に差し替え
- `src/app/dm/decks/DeckList.tsx`
  - 検索: 共通 helper 利用
  - sanitizer: `handleFreeCreate` / `handleChipCreate` / `handleUpdate` / `handleCreateTuning` / `handleUpdateTuning` ← デッキ名のみ
  - 注意書き文言変更 (L366)
- `src/app/pokepoke/decks/DeckList.tsx`
  - 同上 (検索は `[name, display(name)]` 2 系を渡す)
  - 注意書き文言変更 (L373)
- `src/lib/actions/deck-actions.ts` — `createDeck` / `updateDeck` 入口で `stripAllWhitespace` 適用後に重複チェック・保存
- `src/lib/pokepoke/limitless-sync.ts` または `src/lib/pokepoke/deck-translator.ts` — `name_ja` (翻訳後) のみ空白削除
- `src/app/dm/stats/page.tsx` — `useDateRange()` に差し替え（GameProvider 経由で dm が解決される）
- `src/app/pokepoke/stats/page.tsx` — `useDateRange()` に差し替え（GameProvider 経由で pokepoke が解決される）
- `src/app/dm/stats/deck/[deckName]/page.tsx`
- `src/app/dm/stats/opponent/[deckName]/page.tsx`
- `src/app/pokepoke/stats/deck/[deckName]/page.tsx`
- `src/app/pokepoke/stats/opponent/[deckName]/page.tsx`
- `src/app/dm/battle/page.tsx` — `useDateRange()` に差し替え (現状 URL params 非対応なので新規連携。GameProvider 経由で dm が解決される)
- `src/app/pokepoke/battle/page.tsx` — `useDateRange()` 同上（GameProvider 経由で pokepoke が解決される）

### 3.3 触らない
- `src/components/battle/BattleHistoryList.tsx` (期間自体は battle/page 側で管理)
- `src/components/battle/DateRangeCalendar.tsx` (props インターフェースは変更不要)
- `src/components/admin/AdminUserStats.tsx` / `AdminUserBattles.tsx` (scope 外)
- `src/lib/actions/deck-actions.ts` の `createTuning` / `updateTuning` (チューニング名は対象外)
- `src/lib/actions/admin-actions.ts` の `addOpponentDeck` / `updateOpponentDeck` / `updateOpponentDeckNameJa` (対面デッキは scope 外)
- `src/lib/supabase/database.types.ts` (DDL 追加だけなら型再生成不要だが、必要なら別途 regen)

## 4. 共通 utility / hook 設計

### 4.1 検索正規化 helper (`src/lib/search/normalize.ts`)

```ts
// 文字列を比較用に正規化: NFKC → lowercase → ひらがな→カタカナ
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

// query が candidates のいずれかに includes するかをチェック
// candidates: 1 件のアイテムにつき複数の検索対象文字列 (例: [英語名, 表示名])
export function matchesQuery(query: string, candidates: ReadonlyArray<string>): boolean {
  if (!query) return true;
  const q = normalizeQuery(query);
  return candidates.some((s) => normalizeQuery(s).includes(q));
}
```

- 既存 `OpponentDeckSelector.tsx:44-47` の `normalizeQuery` と完全同一ロジック
- dm DeckList: `matchesQuery(searchQuery, [name])`
- pokepoke DeckList: `matchesQuery(searchQuery, [name, display(name)])`
- OpponentDeckSelector: ローカル定義削除して import に置換 (filterByQuery 内部の `[s, display(s)]` 渡し維持)

### 4.2 空白削除 sanitizer (`src/lib/util/whitespace.ts`)

```ts
// 半角スペース、全角スペース、タブ、改行など全ての空白を削除
// \s ではなく Unicode 空白カテゴリを使う (全角スペース U+3000 は \s に含まれる/含まれないが
// 実装依存なので明示的に列挙する案も検討)
export function stripAllWhitespace(s: string): string {
  // 1) NFKC で全角→半角の互換変換 (任意。デッキ名で全角英数は表示崩れになるので意図的に
  //    残したいケースもあるため、まずは「空白文字のみ削除」「NFKC は適用しない」方針)
  // 2) \s + 全角スペース U+3000 + zero-width space (U+200B) 等
  return s.replace(/[\s　​-‍﻿]/g, "");
}
```

**設計判断**:
- `\s` には JavaScript V8 では U+3000 が含まれる (ES2015 以降)。ただし古いランタイム互換のため U+3000 は明示
- zero-width space (U+200B〜U+200D, U+FEFF) は貼り付け事故対策で削除
- NFKC 適用はしない (全角英字「Ａ」を「A」に変換すると既存の意図と異なる可能性あり、別件)
- 戻り値が空文字になるケース (入力が空白のみ) は呼び出し側で「空名前エラー」として既存の trim チェックと同様に弾く

### 4.3 期間指定共通 hook (`src/hooks/use-date-range.ts`)

```ts
"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";
import { useGameOptional } from "@/lib/games/context";

const STORAGE_KEY = (game: GameSlug) => `dateRangeStart:${game}`;

function getDefaultStart(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString("sv-SE");
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export function useDateRange() {
  const gameMeta = useGameOptional();
  const gameSlug: GameSlug = gameMeta?.slug ?? DEFAULT_GAME;
  const searchParams = useSearchParams();

  const [startDate, setStartDateState] = useState<string>(() => {
    // SSR safe: initial render は default (URL params もこの時点では取れない)
    return getDefaultStart();
  });
  const [endDate, setEndDateState] = useState<string>(() => getToday());
  const [ready, setReady] = useState(false);

  // mount 時 / gameSlug 変化時に URL > localStorage > default の優先順位で再決定
  useEffect(() => {
    const urlStart = searchParams.get("start");
    const urlEnd = searchParams.get("end");

    let resolvedStart: string;
    if (urlStart) {
      // URL は今回の描画にのみ使う。localStorage は書き換えない (Resolved Decisions:
      // 「URL は表示のみ (LS 不変)」)。共有リンクや詳細 URL 経由で他人の期間を一度
      // 見ただけで自分のゲーム別作業期間がリセットされる事故を防止する。
      resolvedStart = urlStart;
    } else {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY(gameSlug));
        resolvedStart = saved ?? getDefaultStart();
      } catch {
        resolvedStart = getDefaultStart();
      }
    }
    const resolvedEnd = urlEnd ?? getToday();

    setStartDateState(resolvedStart);
    setEndDateState(resolvedEnd);
    setReady(true);
  }, [gameSlug, searchParams]);

  const setStartDate = (s: string) => {
    setStartDateState(s);
    try {
      window.localStorage.setItem(STORAGE_KEY(gameSlug), s);
    } catch {
      /* ignore */
    }
  };

  // 終了日は保存しない (URL or 今日 デフォルトのまま)
  const setEndDate = (e: string) => setEndDateState(e);

  // DateRangeCalendar の onRangeChange (start, end 両方を一度に変更) 用
  const setRange = (s: string, e: string) => {
    setStartDate(s);
    setEndDate(e);
  };

  return { startDate, endDate, setStartDate, setEndDate, setRange, ready };
}
```

**設計判断**:
- `useFormat` (src/hooks/use-format.ts) の `selectedFormat:${gameSlug}` パターンに踏襲
- 初回 render は SSR safe default → mount 後 useEffect で URL/localStorage を resolve
- `ready` フラグでチラつき防止: 各 page で `if (!ready) return null` または既存の loading state と整合させる
- URL に start があってもこの描画にだけ使い、localStorage は書き換えない (共有リンクや詳細 URL を一度開いただけで自分の作業期間がリセットされる事故を防止)。localStorage 更新は DateRangeCalendar での明示変更時 (`setStartDate` / `setRange` 経由) のみ
- 終了日は仕様通り保存しない (URL > 今日 のフォールバック)

**`searchParams` を依存配列に入れる影響**: Next.js App Router の `useSearchParams` は安定参照 (リファレンス変わらず) なので過剰再実行はしないが、念のため `searchParams.toString()` を依存にする実装も検討対象 (plan-critic で評価)。

## 5. UI 変更

### 5.1 検索ロジック差し替え
- `OpponentDeckSelector.tsx`: ローカル `normalizeQuery` 削除 → `import { normalizeQuery, matchesQuery } from "@/lib/search/normalize"`。`filterByQuery` 関数を簡潔化
- dm `DeckList.tsx:79-83`: `filterByQuery = (items) => items.filter((s) => matchesQuery(searchQuery, [s]))`
- pokepoke `DeckList.tsx:86-90`: `filterByQuery = (items) => items.filter((s) => matchesQuery(searchQuery, [s, display(s)]))`

### 5.2 デッキ名 sanitizer 適用 (UI 側)

dm/pokepoke `DeckList.tsx` の **デッキ名** ハンドラに `stripAllWhitespace` を通す。チューニング名ハンドラは触らない:

- `handleFreeCreate`: `const cleaned = stripAllWhitespace(freeInput.trim())` → 空なら toast「デッキ名を入力してください」、非空なら `createDeck(cleaned, ...)`
- `handleChipCreate(label)`: 同上 `stripAllWhitespace(label.trim())` を渡す
- `handleUpdate`: `const cleaned = stripAllWhitespace(editName.trim())` → 空なら無効、非空なら `updateDeck(id, cleaned)`
- `handleCreateTuning` / `handleUpdateTuning`: **触らない** (チューニング名は空白許容)

**注意 (調査で発見)**: pokepoke の `handleChipCreate` は表示名 (label = display(name)) を渡す既存挙動がある。今回はこの仕様は変えず、sanitizer だけ通す。chip の元 name が英語で、表示名が日本語の場合、空白削除後に DB に保存される deck name は「日本語の空白なし」になる。これは既存挙動と同一 (display 名が日本語のみで空白なしのケース) と整合する。

**追加対応 (必須)**: pokepoke `DeckList.tsx` の `filteredMajor` / `filteredMinor` / `filteredOther` の chip 描画部にある `isRegistered = registeredNames.has(name) || registeredNames.has(label)` を **`isRegistered = registeredNames.has(name) || registeredNames.has(label) || registeredNames.has(stripAllWhitespace(label))`** に変更する。これを行わないと、sanitize 後に DB へ保存された「内部空白なし deck name」を chip 側 (label は内部空白あり) で照合できず、登録済 chip が disabled にならない / 再タップで `createDeck` 重複チェックの「同じ名前のデッキが既に登録されています」エラーが発生する UX 退化が起きる。`registeredNames` の生成側でも `name` と `stripAllWhitespace(name)` 両方を Set に入れる設計にすれば呼び出し側を変えずに済むが、今回は呼び出し側 3 箇所に統一して `stripAllWhitespace(label)` を追加照合する方針 (sanitizer の影響範囲を局所化)。
- §3.2 編集対象に「pokepoke `DeckList.tsx` の chip 描画 3 箇所の isRegistered 判定」を明示追加

### 5.3 注意書き文言変更
- `src/app/dm/decks/DeckList.tsx:366` および `src/app/pokepoke/decks/DeckList.tsx:373`
- 現在: `※対戦記録登録時サーバー内で共有されます（他ユーザーには非公開）`
- 変更後: `※チューニング内容は対戦記録時、戦績共有中のDiscordサーバー内で共有されます（他ユーザーには非公開）`
- 共通コンポーネント化はしない (scope 外)

## 6. Server actions 変更

### 6.1 `src/lib/actions/deck-actions.ts`

```ts
// createDeck (L27-56)
export async function createDeck(name: string, format: string, game: GameSlug = DEFAULT_GAME) {
  const cleaned = stripAllWhitespace(name.trim());
  if (cleaned.length === 0) {
    throw new Error("デッキ名を入力してください");
  }
  // 既存の重複チェック (user_id, game_title, name=cleaned, format, is_archived=false)
  // ...insert with name: cleaned (戻り値型は Promise<Deck> のまま維持し、既存呼び出し側 try/catch 規約を温存)
}

// updateDeck (L58-83)
export async function updateDeck(id: string, name: string) {
  const cleaned = stripAllWhitespace(name.trim());
  if (cleaned.length === 0) {
    throw new Error("デッキ名を入力してください");
  }
  // 既存の重複チェック (id != id, name=cleaned)
  // ...update with name: cleaned (戻り値型は Promise<void> のまま維持し、既存呼び出し側 try/catch 規約を温存)
}
```

- `createTuning` / `updateTuning` は変更しない (チューニング名は対象外)
- 多重防御: UI 側 + ここで両方 sanitize する (UI 経由でない API 呼び出し対策)

### 6.2 PlayLimitless 取り込み

`src/lib/pokepoke/deck-translator.ts` の `translateDeckName(nameEn)` の返り値 (= `name_ja`) を呼び出し側で sanitize する。または `translateDeckName` 内部で sanitize する。

推奨: **呼び出し側 (`limitless-sync.ts`)** で適用 (`LimitlessRow` のフィールド名は `name_en` で、`apply_limitless_snapshot` RPC は JSON キー `name_en` / `name_ja` を `v_row->>'name_en'` / `v_row->>'name_ja'` で読む):
```ts
const nameJa = translateDeckName(r.name_en);
const cleanedNameJa = nameJa ? stripAllWhitespace(nameJa) : null;
// translated に { name_en: r.name_en, name_ja: cleanedNameJa, ... } を入れて
// RPC apply_limitless_snapshot にそのまま渡す。name_en は Limitless 内部キーなので空白削除しない。
```

理由: `deck-translator.ts` は文字列変換責務、`limitless-sync.ts` が DB 書き込み境界。

`opponent_deck_master.name` / `name_en` は Limitless キーなので**空白削除しない**。

## 7. DB Migration 設計

### 7.1 概要 / 順序

1 つの migration ファイル (`supabase/migrations/<timestamp>_decks_strip_whitespace_and_dedupe.sql`) で以下を**一トランザクション内で**実施 (trigger 一時無効化に依存するため、途中失敗時に trigger 状態が宙ぶらりんにならないことが必須):

**transaction 境界の方針**:
- Supabase CLI / migration runner が暗黙 BEGIN/COMMIT を提供するか、明示 `BEGIN; ... COMMIT;` が必要かはバージョン依存。**実装時に staging で挙動を必ず検証**する (例: 途中に故意のエラーを入れた dry-run migration を staging に流し、trigger が ENABLE に戻ること = `pg_trigger.tgenabled = 'O'` を確認)
- 明示 BEGIN/COMMIT が CLI runner と相性が悪い (例: 自動 trans wrap と二重になり SAVEPOINT エラー) 場合は、暗黙 transaction に任せる。どちらの方針かは staging 検証で確定してから本 migration に反映
- いずれにせよ、**migration 失敗時に `ALTER TABLE public.battles DISABLE TRIGGER` が ROLLBACK されること** が staging で確認できなければ production 適用不可 (§10.2 troubleshooting 参照)

**処理順序**:

1. (明示か暗黙かは staging で確定) transaction 開始
2. `ALTER TABLE public.battles DISABLE TRIGGER battles_normalize_deck_names;`
3. 重複検出 + keeper 選定 (CTE で duplicates 計算 → 永続ログテーブル `public._decks_merge_log_2026_05_18` に保存) — Step A
4. battles の `my_deck_id` を keeper に付け替え、`my_deck_name` を keeper の clean 名に明示更新 — Step B
5. tuning の統合判定を永続ログテーブル `public._tunings_merge_log_2026_05_18` に保存し、battles の `tuning_id` を keeper 側 tuning に付け替え (同名 tuning 衝突解決)、`tuning_name` を keeper 側 tuning.name に明示更新、duplicate deck の deck_tunings を keeper deck に move (同名衝突なし分)、衝突分は DELETE — Step C
6. duplicate deck を `is_archived = true`、`name` も clean 名に揃える (追跡しやすさのため `name = stripped(name)`、`sort_order` / `created_at` 保持) — Step D
7. 残った全 `decks.name` を clean 名に UPDATE (内部空白あり deck の純粋 rename) — Step E
8. 残った全 `battles.my_deck_name` を `decks.name` (clean) からコピー (snapshot 同期) — Step F
9. ログテーブルの hardening (ENABLE RLS + REVOKE FROM PUBLIC/anon/authenticated、RLS policy は作らない) — Step G
10. `handle_new_user()` を `regexp_replace(COALESCE(odm.name_ja, odm.name), '[[:space:]　​-‍﻿]', '', 'g')` 入りに `CREATE OR REPLACE` (現行 multi-game + name_ja 優先を保持)
11. `decks` / `battles` に CHECK 制約追加 (内部空白禁止、統一パターン `'[[:space:]　​-‍﻿]'`)
12. `ALTER TABLE public.battles ENABLE TRIGGER battles_normalize_deck_names;`
13. `COMMIT;`

### 7.2 trigger 一時無効化

```sql
-- named trigger のみ無効化 (USER 一括無効化は他 trigger に影響するので避ける)
ALTER TABLE public.battles DISABLE TRIGGER battles_normalize_deck_names;

-- ...重複統合処理...

ALTER TABLE public.battles ENABLE TRIGGER battles_normalize_deck_names;
```

**根拠**:
- `normalize_battle_deck_names()` 関数は ID 不変 UPDATE で `NEW.my_deck_name := OLD.my_deck_name` し、UI 改ざんから snapshot を守る
- migration では `my_deck_name` を明示的に書き換える必要があるため、この trigger を一時的に無効化する
- 同時に `tuning_name` の snapshot も書き換える必要があり、これも同 trigger 管轄

**注意点**:
- migration トランザクション内での DISABLE/ENABLE は同セッション/同トランザクションでのみ有効
- 失敗時は `ROLLBACK` で trigger 状態も自動的に元に戻る (PostgreSQL のトランザクション保証)。**ただしこれは migration 全体が単一トランザクション内で実行される場合に限る** — Supabase CLI / runner が暗黙 transaction を提供するかはバージョン依存のため、§7.1 の方針通り staging で挙動検証。検証で「失敗時に trigger が DISABLE のまま残る」事象が確認されたら、明示 `BEGIN;` / `COMMIT;` か、§10.2 troubleshooting の trigger 復旧手順を案内する
- 他セッション (アプリ側の INSERT/UPDATE) には影響しない (`DISABLE TRIGGER` は ALTER TABLE のため ACCESS EXCLUSIVE LOCK 取得、migration 中は他セッション write が待たされる)

### 7.3 重複統合手順 (詳細 SQL 設計)

#### Step A: 重複検出 + keeper 選定

```sql
-- 全 decks の clean 名 (内部空白削除) を計算し、(user_id, game_title, format, cleaned_name)
-- でグルーピング。is_archived = false のみ対象 (archive 済みは触らない)
-- keeper: 「clean 名前と完全一致 (= 元から空白なし) を最優先 → created_at 最古 → id 辞書順最小」
-- duplicates を永続ログテーブルとして保存 (audit / 事故調査 / best effort 部分復旧用、Step G で hardening)。
-- 一時テーブルにすると COMMIT 後に失われ、後日の audit 参照や手動 best effort 復旧が不可能になるため永続化する
-- (完全 rollback は per-row 情報不足で本 log 単体では不可、§10.2 / Resolved Decisions [rollback精度] 参照)。
-- PostgreSQL CTAS の AS 句に CTE を埋め込む形 (CREATE TABLE ... AS WITH ... SELECT ...) を使う。
-- ※ `WITH ... CREATE TABLE ... AS SELECT ...` の順は PG では構文エラー。CTAS が外側に来る。

CREATE TABLE public._decks_merge_log_2026_05_18 AS
WITH normalized AS (
  SELECT
    id,
    user_id,
    game_title,
    format,
    name AS original_name,
    regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g') AS cleaned_name,
    (name = regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g')) AS already_clean,
    created_at,
    sort_order
  FROM public.decks
  WHERE is_archived = false
),
ranked AS (
  SELECT
    *,
    -- keeper を 1 つ選ぶ: already_clean=true (元から空白なし) を優先、次に created_at 古い、最後に id
    ROW_NUMBER() OVER (
      PARTITION BY user_id, game_title, format, cleaned_name
      ORDER BY already_clean DESC, created_at ASC, id ASC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY user_id, game_title, format, cleaned_name) AS group_size
  FROM normalized
),
duplicates AS (
  -- duplicate 側 (rn > 1) と keeper 側 (rn = 1) のペアを作成
  SELECT
    d.id AS duplicate_id,
    k.id AS keeper_id,
    k.cleaned_name
  FROM ranked d
  JOIN ranked k
    ON k.user_id = d.user_id
   AND k.game_title = d.game_title
   AND k.format = d.format
   AND k.cleaned_name = d.cleaned_name
   AND k.rn = 1
  WHERE d.rn > 1 AND d.group_size > 1
)
SELECT * FROM duplicates;

COMMENT ON TABLE public._decks_merge_log_2026_05_18 IS
  '2026-05-18 deck whitespace cleanup の rollback/audit 用ログ。
   duplicate_id (archive された deck の id), keeper_id (battles が付け替えられた先の deck id),
   cleaned_name (clean 後の名前) を保持。service_role / postgres のみ参照可 (Step G で hardened)。';
```

以降の SQL は `_deck_merge_map` の代わりに `public._decks_merge_log_2026_05_18` を参照する (本文中の表記は短縮形 `_deck_merge_map` のまま、実装時は実テーブル名に置換)。

#### Step B: battles の my_deck_id / my_deck_name 付け替え

```sql
UPDATE public.battles b
SET
  my_deck_id = m.keeper_id,
  my_deck_name = m.cleaned_name
FROM _deck_merge_map m
WHERE b.my_deck_id = m.duplicate_id;
```

trigger 無効化下なので `my_deck_name` がそのまま書き込まれる。

#### Step C: tuning 統合

```sql
-- duplicate deck 配下の tuning と、keeper deck 配下の同名 tuning のマッピング。
-- tuning_merge を永続ログテーブルとして保存 (rollback / audit 用、Step G で hardening)。
-- ※ `WITH ... CREATE TABLE ... AS SELECT ...` の順は PG では構文エラー。CTAS が外側に来る。

CREATE TABLE public._tunings_merge_log_2026_05_18 AS
WITH dup_tunings AS (
  SELECT
    dt.id AS dup_tuning_id,
    dt.deck_id AS dup_deck_id,
    dt.name AS dup_tuning_name,
    m.keeper_id
  FROM public.deck_tunings dt
  JOIN _deck_merge_map m ON dt.deck_id = m.duplicate_id
),
keeper_tunings AS (
  SELECT
    kt.id AS keeper_tuning_id,
    kt.deck_id AS keeper_deck_id,
    kt.name AS keeper_tuning_name
  FROM public.deck_tunings kt
  WHERE kt.deck_id IN (SELECT keeper_id FROM _deck_merge_map)
),
tuning_merge AS (
  SELECT
    dt.dup_tuning_id,
    dt.dup_deck_id,
    dt.keeper_id,
    dt.dup_tuning_name,
    kt.keeper_tuning_id
  FROM dup_tunings dt
  LEFT JOIN keeper_tunings kt
    ON kt.keeper_deck_id = dt.keeper_id
   AND lower(trim(kt.keeper_tuning_name)) = lower(trim(dt.dup_tuning_name))
)
SELECT * FROM tuning_merge;

COMMENT ON TABLE public._tunings_merge_log_2026_05_18 IS
  '2026-05-18 deck whitespace cleanup の tuning 統合 rollback/audit 用ログ。
   dup_tuning_id (削除 or 移管された tuning id), keeper_tuning_id (battles が付け替えられた先、NULL なら deck_id move),
   dup_deck_id / keeper_id, dup_tuning_name を保持。service_role / postgres のみ参照可 (Step G で hardened)。';

-- 以降の SQL は `_tuning_merge_map` の代わりに `public._tunings_merge_log_2026_05_18` を参照する

-- C-1: 同名 tuning が keeper 側に存在する dup tuning → battles.tuning_id 付け替え + tuning_name 更新
UPDATE public.battles b
SET
  tuning_id = tm.keeper_tuning_id,
  tuning_name = (SELECT name FROM public.deck_tunings WHERE id = tm.keeper_tuning_id)
FROM _tuning_merge_map tm
WHERE b.tuning_id = tm.dup_tuning_id AND tm.keeper_tuning_id IS NOT NULL;

-- C-2: keeper 側に同名 tuning が**ない** dup tuning → deck_id を keeper に move
UPDATE public.deck_tunings dt
SET deck_id = tm.keeper_id
FROM _tuning_merge_map tm
WHERE dt.id = tm.dup_tuning_id AND tm.keeper_tuning_id IS NULL;

-- C-3: 同名 tuning だった dup tuning は DELETE (battles はすでに C-1 で付け替え済み)
DELETE FROM public.deck_tunings dt
USING _tuning_merge_map tm
WHERE dt.id = tm.dup_tuning_id AND tm.keeper_tuning_id IS NOT NULL;
```

**注意**:
- `deck_tunings_name_unique_idx (deck_id, lower(trim(name)))` 既存 UNIQUE がある。C-2 で move 時、移動先 (keeper_deck) に同名 (lower/trim ベース) が既に存在すれば違反。`tm.keeper_tuning_id IS NULL` で除外しているので安全
- ただし C-2 後に「内部空白で別名と判定されていた tuning」が衝突する可能性は今回 scope 外 (チューニング名は空白許容なので別名のまま OK)

#### Step D: duplicate deck の archive

```sql
UPDATE public.decks
SET
  is_archived = true,
  name = regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g')  -- 追跡しやすさのため clean 名に揃える (CHECK と統一パターン)
  -- sort_order, created_at は保持 (rollback 時の追跡を容易に)
WHERE id IN (SELECT duplicate_id FROM _deck_merge_map);
```

**注意**:
- `decks_active_name_unique_idx ... WHERE is_archived = false` なので、archive 化と name 変更を同時にやっても UNIQUE 衝突しない
- archive 後の `name` を clean 名にしても、archive 済みは UNIQUE 制約外なので keeper と同名でも問題なし
- archive 行を unarchive (`UPDATE decks SET is_archived = false WHERE id = ?`) するだけでは復旧にならない (battles の `my_deck_id` はすでに keeper を指しており、duplicate 由来の battles を識別する情報は残していない)。完全復旧が必要な場合は §10.2 の通り pg_dump / Supabase backup からの restore が前提

#### Step E: 残った全 decks の name を clean に揃える (非重複の内部空白 deck + 既存 archived 行)

**重要**: `is_archived` フィルタを付けずに active / archived 両方を対象にする。CHECK 制約 (§7.5 `decks_name_no_whitespace_check`) はテーブル全行を評価するため、過去に手動 archive された / 20260513000001 dedupe で archive された内部空白入り行が残っていると、Step F 後の CHECK ADD で migration 全体が失敗する。

```sql
UPDATE public.decks
SET name = regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g')
WHERE name <> regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g');
```

注意: archived 行を rename した結果 `(user_id, game_title, format, lower(trim(name)))` が active 行と一致しても、`decks_active_name_unique_idx` は `WHERE is_archived = false` の partial unique なので衝突しない (archived 行は UNIQUE 対象外)。

#### Step F: battles.my_deck_name を decks.name から再同期

```sql
-- 重複統合済み + name 変更済み deck を指す battles の my_deck_name を最新化
UPDATE public.battles b
SET my_deck_name = d.name
FROM public.decks d
WHERE b.my_deck_id = d.id
  AND b.my_deck_name <> d.name;

-- tuning_name 同期 (tuning が rename されたケースは今回ないが、move されたケースは name 不変なので不要)
-- ただし安全のため:
UPDATE public.battles b
SET tuning_name = t.name
FROM public.deck_tunings t
WHERE b.tuning_id = t.id
  AND b.tuning_name <> t.name;
```

#### Step G: ログテーブルの hardening (Resolved Decisions: merge log 保存 → 永続テーブル)

```sql
-- アプリ利用者 (anon / authenticated) からの参照を完全に塞ぐ。
-- service_role は RLS は bypass するが table privilege は別問題のため、明示的に GRANT SELECT を付与する
-- (RLS bypass ≠ table privilege grant。Supabase の service_role role でも grant がなければ permission denied)。
-- RLS policy は作成しない = anon / authenticated は SELECT すら不可。

ALTER TABLE public._decks_merge_log_2026_05_18 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._decks_merge_log_2026_05_18 FROM PUBLIC;
REVOKE ALL ON TABLE public._decks_merge_log_2026_05_18 FROM anon, authenticated;
GRANT SELECT ON TABLE public._decks_merge_log_2026_05_18 TO service_role;

ALTER TABLE public._tunings_merge_log_2026_05_18 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._tunings_merge_log_2026_05_18 FROM PUBLIC;
REVOKE ALL ON TABLE public._tunings_merge_log_2026_05_18 FROM anon, authenticated;
GRANT SELECT ON TABLE public._tunings_merge_log_2026_05_18 TO service_role;
```

**注意**:
- private schema に置く案もあるが、Supabase の publishing scope は public schema 既定なので、`ENABLE RLS + RLS policy 無し` で十分実効的にアクセス封鎖できる (Resolved Decisions の補足方針通り)
- ログテーブルに含める情報: `duplicate_id` / `keeper_id` / `cleaned_name` (decks) と `dup_tuning_id` / `keeper_tuning_id` / `dup_deck_id` / `keeper_id` / `dup_tuning_name` (tunings)。これらは **audit / 事故調査 / best effort 部分復旧** の材料 (Resolved Decisions [rollback精度] 参照)。per-battle log や DELETE 済 tuning 行の full dump は **作らない方針** のため、完全 rollback はこれらだけでは不可能。完全 rollback が必要な場合は migration 適用前の `pg_dump` / Supabase backup から restore する (§10.2 / §10.3 参照)
- 将来削除する場合は別 migration で `DROP TABLE public._decks_merge_log_2026_05_18; DROP TABLE public._tunings_merge_log_2026_05_18;` する (rollback 期間が過ぎたら掃除)

### 7.4 `handle_new_user()` の更新

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, is_guest)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.is_anonymous
  );

  IF NOT NEW.is_anonymous THEN
    -- 現行 (20260510000002) を踏襲: COALESCE(name_ja, name) で日本語表示名を優先、
    -- WHERE 句で dm/pokepoke の両ゲーム初期デッキを生成、ORDER BY を維持。
    -- 本 migration の追加点は最終文字列に対する空白削除 (regexp_replace) のみ。
    INSERT INTO public.decks (user_id, name, format, game_title, sort_order)
    SELECT
      NEW.id,
      regexp_replace(COALESCE(odm.name_ja, odm.name), '[[:space:]　​-‍﻿]', '', 'g'),  -- ★ 空白削除 (CHECK 制約と一致するパターン: ASCII whitespace + U+3000 + U+200B〜U+200D + U+FEFF)。PG の `\s` はデフォルトロケールで ASCII 空白のみで U+3000 を含まないため、明示クラスで書く。
      odm.format,
      odm.game_title,
      odm.sort_order
    FROM public.opponent_deck_master odm
    WHERE odm.category = 'major'
      AND odm.is_active = true
      AND odm.game_title IN ('dm', 'pokepoke')
    ORDER BY odm.game_title, odm.format, odm.sort_order;
  END IF;

  RETURN NEW;
END;
$$;
```

### 7.5 新規 CHECK 制約

```sql
-- decks.name: 内部空白禁止 (既存 length check はそのまま残す)
-- ※ regexp_replace と統一パターン。PG `\s` は ASCII 空白のみで U+3000 を含まないため明示列挙が必要
ALTER TABLE public.decks
  ADD CONSTRAINT decks_name_no_whitespace_check
  CHECK (name !~ '[[:space:]　​-‍﻿]');

-- battles.my_deck_name: 同上
ALTER TABLE public.battles
  ADD CONSTRAINT battles_my_deck_name_no_whitespace_check
  CHECK (my_deck_name !~ '[[:space:]　​-‍﻿]');
```

**設計判断**:
- 統一パターン `'[[:space:]　​-‍﻿]'`: POSIX `[:space:]` = ASCII 空白 (`[ \t\n\r\f\v]`) + U+3000 (全角スペース) + U+200B〜U+200D (zero-width 系) + U+FEFF (BOM) を 1 expression でカバー
- §7.3/§7.4 の `regexp_replace(..., '[[:space:]　​-‍﻿]', '', 'g')` と完全一致 → cleanup と CHECK のパターン不一致による migration 失敗を防止
- TS 側 `stripAllWhitespace` (§4.2) の regex も同セットに揃える (V8 の `\s` は U+3000 を含むが、DB と仕様を共有するため明示列挙の正規表現に揃える)
- 既存 `decks_name_length_check` (length と trim) はそのまま残す (別観点の制約)
- migration の最後 (Step F の後) に追加するので、データ整合性は事前 cleanup で保証される

## 8. Supabase staging 適用・検証手順

### 8.0 preflight (適用前)

migration 適用前に Supabase MCP `execute_sql` で対象件数を確認し、想定外の量がないか把握する。0 件であれば「migration は no-op (CHECK だけ追加)」、多数あれば「重複統合がどの程度発生するか事前把握」できる:

```sql
-- 内部空白入り deck 名の件数 (clean 対象、archived 含む = CHECK 制約評価対象と一致)
SELECT
  count(*) FILTER (WHERE is_archived = false) AS dirty_active_decks,
  count(*) FILTER (WHERE is_archived = true)  AS dirty_archived_decks,
  count(*)                                    AS dirty_decks_total
FROM public.decks
WHERE name ~ '[[:space:]　​-‍﻿]';

-- 内部空白入り battle snapshot 名の件数 (clean 対象)
SELECT count(*) AS dirty_battles FROM public.battles
WHERE my_deck_name ~ '[[:space:]　​-‍﻿]';

-- 重複統合される deck 組数の事前推計
WITH normalized AS (
  SELECT user_id, game_title, format,
    regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g') AS cleaned_name
  FROM public.decks WHERE is_archived = false
)
SELECT user_id, game_title, format, cleaned_name, count(*) AS group_size
FROM normalized
GROUP BY user_id, game_title, format, cleaned_name
HAVING count(*) > 1
ORDER BY group_size DESC
LIMIT 50;
```

### 8.1 適用フロー

```bash
# 1. ローカルで dev branch に migration を commit
git checkout dev
git add supabase/migrations/<timestamp>_decks_strip_whitespace_and_dedupe.sql
git commit -m "feat(db): デッキ名空白削除 + 重複統合 + CHECK 制約追加"

# 2. staging への適用 (DB password 入り URL はチャットに貼らない)
export STAGING_DB_URL='postgresql://...'
npm_config_cache=/private/tmp/npm-cache npx supabase db push --db-url "$STAGING_DB_URL" --include-all

# 3. 適用済み migration 一覧確認
npm_config_cache=/private/tmp/npm-cache npx supabase migration list --db-url "$STAGING_DB_URL"

# 4. staging データ整合性確認 (Supabase MCP 経由 read-only):
#    - decks で内部空白を含む行が 0 件であること
#    - battles.my_deck_name で内部空白を含む行が 0 件であること
#    - 重複統合された duplicate deck が is_archived = true で残っていること
#    - keeper deck の battles 件数 = 統合前 (keeper + duplicate) の合計と一致すること
#    - CHECK 制約が登録されていること
```

検証クエリ例 (Supabase MCP `execute_sql` で実行、staging project ref: `uqndrkaxmbfjuiociuns`):

```sql
-- 内部空白を含む deck 名が 0 件
SELECT COUNT(*) FROM public.decks WHERE is_archived = false AND name ~ '[[:space:]　​-‍﻿]';

-- 内部空白を含む battle snapshot 名が 0 件
SELECT COUNT(*) FROM public.battles WHERE my_deck_name ~ '[[:space:]　​-‍﻿]';

-- archive 済み (旧 duplicate) deck の数
SELECT COUNT(*) FROM public.decks WHERE is_archived = true;

-- CHECK 制約確認
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('decks_name_no_whitespace_check', 'battles_my_deck_name_no_whitespace_check');
```

## 9. dev preview での確認観点

Cloudflare dev preview (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev`) で以下を実機 (ブラウザ) で確認:

### 9.1 検索改善
- [ ] dm 使用デッキ管理で「がいあ」で検索 → 「ガイア」「Gaia」「ｶﾞｲｱ」がヒット
- [ ] pokepoke 使用デッキ管理で「ぴかちゅう」「Pikachu」両方検索で同じ結果
- [ ] 対戦記録の対面デッキ検索 (OpponentDeckSelector) の挙動が変わっていないこと (regression check)

### 9.2 デッキ名空白禁止
- [ ] dm 新規作成で「ガイ アッシュ カイザー」入力 → 「ガイアッシュカイザー」で保存される
- [ ] dm 編集モードで内部空白入りに変更 → 保存時に空白削除
- [ ] pokepoke 「ピカ チュウ ex」 → 「ピカチュウex」で保存
- [ ] チューニング名は空白入りで保存できる (regression check)
- [ ] チップ追加 (suggestions から) でも sanitize される

### 9.3 重複統合 (staging データで確認)
- [ ] 内部空白で別レコードになっていた deck が統合され、合算された戦績が表示される
- [ ] duplicate deck は管理画面・分析画面に表示されない (is_archived = true)
- [ ] keeper deck の名前が clean 名 (空白削除済) で表示される

### 9.4 期間指定保存
- [ ] dm 分析で 2026-03-01 〜 を選択 → ページ遷移後も保持される
- [ ] dm から pokepoke に切替 → 別の期間で開始される (ゲーム別保存)
- [ ] dm 対戦記録の履歴タブでも期間指定が反映される (現状未対応の URL params 連携が動く)
- [ ] URL `?start=2026-02-01` 付きで開く → URL 値で表示される、**ただし localStorage は変更されない** (LS 不変方針)。同じゲームを別タブで `?start=` なしで開くと旧 localStorage 値で表示される

### 9.5 注意書き文言
- [ ] dm/pokepoke 使用デッキ管理画面の注意書きが新文言になっている

## 10. リスクと rollback

### 10.1 主要リスク

| リスク | 影響 | 緩和策 |
|---|---|---|
| trigger 一時無効化中に他セッションが battles 書き込み | snapshot 整合性破壊 | DISABLE TRIGGER は ALTER TABLE で ACCESS EXCLUSIVE LOCK 取得 → migration 中は他 write がブロック。アプリ側はリトライまたは一時的なエラー表示 |
| 重複統合の keeper 選定ミス | 戦績が想定外の deck に集約 | keeper 選定基準を「already_clean → created_at 最古 → id」で deterministic にし、staging で全 user 分の merge map を事前確認 |
| `regexp_replace` の `\s` でカバーされない空白 | clean 後も残る | CHECK 制約で `　`, `​-‍`, `﻿` も併記 + sanitizer も同パターン使用 |
| `handle_new_user` 変更で既存挙動への影響 | 新規ユーザーの初期デッキ崩れ | staging で新規ユーザー作成テスト + master 側 name に空白がないことを事前確認 |
| pokepoke `handleChipCreate` の表示名 sanitize で意図しない rename | label が日本語表示名で空白含む場合 stripped 名に変わる | scope 外で挙動変更ありえる旨を report に明記。display 名側に空白が含まれるケースは現状ない or 少ないと想定 (staging で確認) |
| CHECK 制約追加時の既存データ違反 | migration 失敗 | Step E まで完了後に追加するので、事前 cleanup が保証 |

### 10.2 rollback 戦略

**コード rollback**:
- Cloudflare Dashboard → Deployments → 過去のデプロイ → Rollback ボタン (1 クリック数秒)

**DB rollback** (production 適用後):

⚠️ **完全 rollback は本 migration 単体では不可能**。重複統合は per-row 情報を残さずに行うため不可逆:
- battles の `my_deck_id` が keeper に書き換わっており、**どの battle が元 keeper 由来でどれが duplicate 由来か** を per-row で識別する情報は残していない (per-battle log は作らない方針、Resolved Decisions [rollback精度] 参照)
- deck_tunings は DELETE / move されており、**削除された tuning の `sort_order` / `created_at` / `game_title` などの full row data は復元不可** (full row dump も作らない方針)
- Step E で active / archived 両方の内部空白 deck も rename しているため、log には clean 後の name しか残らない (元の空白入り name は失う)

**唯一の完全復旧手段**: migration 適用前に取得した **`pg_dump` または `supabase db dump --linked -f backup-YYYYMMDD.sql` で取得したフル backup** から restore すること。Supabase Dashboard / Management API の backup / restore を使う場合は **事前に公式 docs (https://supabase.com/docs/guides/platform/backups) と現在の project plan (Free/Pro/Team/Enterprise) で利用可否・retention・PITR add-on の有無を必ず確認** する (§10.3 必須確認参照)。

**永続ログテーブル `public._decks_merge_log_2026_05_18` / `public._tunings_merge_log_2026_05_18` の用途**:
- **audit / 事故調査用**: 「どの user の どの duplicate deck が どの keeper に統合されたか」「どの tuning ID が削除 / 移管されたか」を後から確認するための足跡
- **best effort 部分復旧支援**: 一部のケース (例: 「特定 user の特定 deck のみ unarchive して戻したい」「特定 user に統合エラーが出たので原因確認したい」) では、log を手掛かりに **手動 SQL で best effort 復旧** が可能。ただし完全な状態保証はできない
- 完全自動逆 migration を作る材料にはならない (per-row 情報不足のため)

**ログがなくても個別に rollback 可能な変更**:
- CHECK 制約 (`decks_name_no_whitespace_check` / `battles_my_deck_name_no_whitespace_check`) は `ALTER TABLE ... DROP CONSTRAINT ...` で簡単に外せる
- `handle_new_user()` は `CREATE OR REPLACE` で前バージョン (20260510000002) に戻せる

**ログテーブル運用**: 必要期間 (例: 30 日) 経過後は別 migration で `DROP TABLE public._decks_merge_log_2026_05_18; DROP TABLE public._tunings_merge_log_2026_05_18;` して掃除

**rollback 順序 (完全復旧が必要な場合)**:
1. アプリ rollback (Cloudflare Dashboard、過去のデプロイから 1 クリック)
2. CHECK 制約 DROP (新コード前提の制約)
3. `handle_new_user()` を旧バージョン (20260510000002) に `CREATE OR REPLACE` で戻す
4. **DB を pg_dump backup / Supabase backup から restore** (重複統合された battles / deck_tunings 状態を元に戻す唯一の方法)
5. ログテーブルは audit 目的で残しても良いし、復旧後に DROP しても良い

**rollback 順序 (部分対応 / 軽微な調整)**:
- ログを参照しつつ、対象 user / deck を絞って手動 SQL で is_archived 戻しや battles 付け替え逆実行を「best effort」で実施
- 完全な状態保証はできない (per-row 情報がないため、duplicate 由来の battles を keeper の battles から分離できない等)
- 影響が広いケースでは完全復旧手順 (上記) を選択する

### 10.2.1 Troubleshooting: migration 失敗時の trigger 状態確認・復旧

本 migration は `battles_normalize_deck_names` trigger を一時的に DISABLE した状態で大量 UPDATE を実行する。trans が ROLLBACK されれば trigger 状態は自動復旧するが、**Supabase CLI / runner の挙動次第では「失敗したのに trigger が DISABLE のまま残る」事故が起こり得る** (§7.1 / §7.2 注意点参照)。

migration が成功/失敗いずれの場合も、必ず以下を実行して trigger 状態を確認する:

```sql
-- trigger 状態確認 (tgenabled = 'O' なら有効、'D' なら無効、'R' / 'A' は replica/always)
SELECT
  tgname,
  tgenabled,
  CASE tgenabled
    WHEN 'O' THEN 'enabled (origin/local)'
    WHEN 'D' THEN '⚠️ disabled'
    WHEN 'R' THEN 'replica only'
    WHEN 'A' THEN 'always'
  END AS status
FROM pg_trigger
WHERE tgrelid = 'public.battles'::regclass
  AND tgname = 'battles_normalize_deck_names';
```

**`tgenabled = 'D'` が返った場合の rescue 手順**:

```sql
-- 即座に trigger を再有効化 (これを実行しないと、以降の battles UPDATE で snapshot 名が
-- 改ざんされる脆弱性が露出する)
ALTER TABLE public.battles ENABLE TRIGGER battles_normalize_deck_names;

-- 再度状態確認
SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.battles'::regclass
  AND tgname = 'battles_normalize_deck_names';
```

**追加調査が必要なケース**:
- trigger が DISABLE のまま、アプリ書き込みが進んでいた可能性がある場合 → `battles` の `my_deck_name` / `tuning_name` が `decks.name` / `deck_tunings.name` と一致しているか抜き打ちチェック (`SELECT count(*) FROM battles b JOIN decks d ON b.my_deck_id = d.id WHERE b.my_deck_name <> d.name;`)
- 不一致が出れば、snapshot 同期 (Step F 相当) を再実行する

**production 環境では migration 適用直後にこの確認クエリを必ず実行する** (§9 / §10.3 にも明記)。

### 10.3 production 適用前の必須確認

- [ ] staging で migration 適用済み + 上記検証クエリ全 pass
- [ ] dev preview で 9. 全項目確認済み
- [ ] **CLAUDE.md ルール**: コード変更を伴う migration は **必ず main 本番反映完了後** に production DB へ適用する。順序逆転禁止
- [ ] **backup / restore 方針確認** (Resolved Decisions [rollback精度] に基づく):
  - 重複統合は不可逆。production 適用前に **以下のいずれかの方法でフル backup を必ず取得**:
    - **主経路 (確実)**: `pg_dump` または `supabase db dump --linked -f backup-YYYYMMDD.sql` (Supabase CLI、`supabase login` + `supabase link` 済前提)。詳細 flag は https://supabase.com/docs/reference/cli/supabase-db-dump 参照
    - **副経路 (要事前確認)**: Supabase Dashboard / Management API の backup / restore 機能。**利用前に必ず公式 docs (https://supabase.com/docs/guides/platform/backups) と現在の project plan で利用可否を確認**:
      - Free Plan: 自動 daily backup の対象だが、docs は CLI での自前エクスポートを推奨
      - Pro Plan: 7 日分、Team: 14 日分、Enterprise: 30 日分の自動 daily backup にアクセス可
      - **「Generate now」のような手動 backup トリガー UI は公式 docs に記載なし** (daily backup は完全自動。時点指定が必要なら PITR add-on)
      - PITR (Pro+ add-on、Small compute 必須、retention 7/14/28 日、daily backup と排他)
      - Restore は Dashboard UI / Management API。進行中は project inaccessible
      - **Storage API 経由のオブジェクトと custom role password は backup に含まれない** 点に注意
  - 取得した backup の保管場所・restore 手順を事前に文書化 (運用 wiki または本 plan に追記)
  - merge log は best effort 復旧の補助にしかならない (§10.2 参照)。pg_dump / supabase db dump がなければ完全 rollback は不可
- [ ] **trigger 復旧手順の事前周知**: §10.2.1 Troubleshooting の trigger 状態確認クエリと rescue 手順を、本番反映を行うオペレータが手元に持っていること
- [ ] ユーザーの明示的「本番反映 + DB 適用」指示を待つ

## 11. 実装順序

1. **共通 utility 追加**
   - `src/lib/search/normalize.ts`
   - `src/lib/util/whitespace.ts`
   - 単体テスト (vitest があれば) または各 helper の動作確認スニペット
2. **検索差し替え (回帰なし確認しやすい順)**
   - `OpponentDeckSelector.tsx` (既存ロジックと同等になることを確認)
   - dm `DeckList.tsx`
   - pokepoke `DeckList.tsx`
3. **sanitizer UI 適用**
   - dm/pokepoke `DeckList.tsx` のデッキ名ハンドラ
4. **Server actions 修正**
   - `deck-actions.ts` (createDeck/updateDeck)
   - `limitless-sync.ts` または `deck-translator.ts`
5. **期間指定 hook 追加 + 各 page 差し替え**
   - `src/hooks/use-date-range.ts`
   - dm/pokepoke stats 4 page + battle 2 page
6. **注意書き文言変更** (dm/pokepoke)
7. **DB migration 作成**
   - `supabase/migrations/<timestamp>_decks_strip_whitespace_and_dedupe.sql`
8. **ローカル lint / build 確認** (§12)
9. **dev branch commit + push** → Cloudflare dev preview ビルド
10. **staging DB に migration 適用** (§8)
11. **staging データで dev preview の検証** (§9)
12. **(ユーザー指示後) main merge + push** → Cloudflare production ビルド
13. **(本番反映完了後、ユーザー指示後) production DB に migration 適用**

## 12. 実装後に実行する検証コマンド

```bash
# lint
npm run lint

# OpenNext for Cloudflare build (Claude 自前検証)
npx opennextjs-cloudflare build

# (vitest があれば) unit test
npm test -- --run

# git status / diff 確認
git status
git diff --stat origin/dev

# Supabase migration list (staging 適用後)
npm_config_cache=/private/tmp/npm-cache npx supabase migration list --db-url "$STAGING_DB_URL"
```

dev preview デプロイ後、Claude 自前でできる検証 (CLAUDE.md `feedback_self_verification.md` に従う):

```bash
# dev preview の SSR HTML を curl で取得し、注意書き文言が新文言になっているか確認
curl -s https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/dm/decks | grep -o "チューニング内容は対戦記録時、戦績共有中のDiscordサーバー"

# Supabase MCP 経由で staging DB の整合性確認 (§8 の検証クエリ実行)
```

ユーザーにブラウザ確認を依頼する項目は §9 の「実機検索」「実機期間指定切替」のみに限定する。

## 13. scope 外論点 (別 PR で対応)

本改修中の調査で発見した既存課題。本 PR では**触らない**:

### (a) MyDeckStatsSection / OpponentDeckStatsSection の game prefix 抜け
- `src/components/stats/MyDeckStatsSection.tsx` の `handleClick` で `router.push('/stats/deck/...')` (game prefix なし) になっている
- 同様に `OpponentDeckStatsSection.tsx` でも `router.push('/stats/opponent/...')`
- 現状の path は `/dm/stats/deck/[deckName]` / `/pokepoke/stats/deck/[deckName]` であるため、ゲーム別ルーティングが機能していない可能性がある
- 別 PR で `game` props を伝播させて prefix 付きで `router.push` するよう修正

### (b) pokepoke `handleChipCreate` が label (表示名) を渡している
- `src/app/pokepoke/decks/DeckList.tsx` の chip 表示部 (L453, L498, L557) が `display(name)` (日本語表示名) を `handleChipCreate(label)` に渡している
- 結果として DB に保存される deck name が「英語の opponent_deck_master.name」ではなく「日本語の display 名」になる
- 設計意図 (日本語化したい) か bug (キーは英語であるべき) かは別途確認が必要
- 本 PR では既存挙動を維持 (sanitizer だけ通す)

---

## 付録: 検討した代替案

### A1. trigger を関数本体で条件分岐させる方式
migration 中だけ `if (current_setting('migration.in_progress', true) = 'true') then ... end if` のような分岐を入れる案。現行 trigger に侵襲的で、別 trigger との整合も考慮必要。今回は採用せず、シンプルな DISABLE/ENABLE で対応。

### A2. duplicate deck を物理削除 (DELETE) する方式
CASCADE で deck_tunings も巻き込まれ、battles は ON DELETE CASCADE なので **戦績も消える**。Step B で battles を先に keeper に付け替えているため、CASCADE 発火時の deck_tunings は空のはず。だが事故時の影響が大きいため archive 方式採用。ユーザー判断でも archive で確定。

### A3. CHECK 制約を既存 `decks_name_length_check` に統合
既存 `CHECK (char_length(name) <= 80 AND char_length(trim(name)) >= 1)` を `CHECK (char_length(name) <= 80 AND char_length(trim(name)) >= 1 AND name !~ '\s')` に変更する案。ALTER 文が複雑になる + 既存制約名と意味が混在するため、別制約として追加する方式採用。

## Resolved Decisions

- [URL→LS書込] URL params に `?start=` がある場合、localStorage の保存値をどう扱うか? → **URL は表示のみ (LS 不変)**
  - 補足方針:
    - URL の `start` / `end` はそのページの表示に優先する
    - ただし `dateRangeStart:{gameSlug}` の localStorage は書き換えない
    - localStorage を更新するのは、ユーザーが `DateRangeCalendar` で開始日を変更した時のみ
    - これにより共有リンクや詳細 URL を一度開いただけで、自分のゲーム別開始日設定が変わる事故を回避

- [merge log保存] 重複統合のマッピング (`_deck_merge_map` / `_tuning_merge_map`) をどう保存するか? → **永続テーブルで残す**
  - 補足方針:
    - `public._decks_merge_log_2026_05_18` / `public._tunings_merge_log_2026_05_18` として恒久保存 (public schema + RLS で実効 private 化)
    - 必須 hardening: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM PUBLIC, anon, authenticated` + RLS policy は作らない (= service_role / postgres / migration 実行者のみ参照可)
    - `COMMENT ON TABLE` で「deck whitespace cleanup rollback/audit log」用途を明記
    - 残す最小カラム: rollback に必要な id (duplicate_id / keeper_id, dup_tuning_id / keeper_tuning_id) + 変更前後の name / tuning_id mapping + archived deck id
    - rollback 期間 (例: 30 日) 経過後は別 migration で `DROP TABLE` して掃除する

- [rollback精度] codex P1 #1 #2 指摘 (per-battle log なし + DELETE 済 tuning row の sort_order/created_at/game_title 復元不可) を受けて、rollback はどこまで対応するか? → **audit only / best effort recovery + pg_dump backup 前提に softening**
  - 補足方針:
    - merge log テーブルは「どの user の どの deck が どの keeper に統合されたか」「どの tuning が削除/移管されたか」の **audit / 事故調査** 用途と明記
    - 一部のケースで手動 SQL による **best effort 部分復旧** は可能、ただし完全自動逆 migration の材料にはならない (per-row 情報不足)
    - 完全 rollback が必要な場合は migration 適用前に取得した `pg_dump` フル backup または Supabase project backup から restore する前提
    - per-battle log や DELETE 済 tuning row の full dump は今回作らない (運用負荷・DB 容量増を回避)
    - §10.2 rollback 戦略をこの方針で書き換え
    - §10.3 production 適用前必須確認に「backup / restore 方針確認」を追加
