-- 2026-05-19: デッキ名から全空白を削除 + 重複統合 + CHECK 制約追加
--
-- 改修内容 (docs/plans/2026-05-18_deck_search_sanitize_date_range.md §7):
--   1. battles_normalize_deck_names trigger を一時的に DISABLE (Step G で ENABLE)
--   2. Step A: 重複検出 + keeper 選定 → 永続ログテーブル _decks_merge_log_2026_05_18
--   3. Step B: battles の my_deck_id を keeper に付け替え + my_deck_name 明示更新
--   4. Step C: tuning 統合判定を永続ログテーブル _tunings_merge_log_2026_05_18 に保存し、
--              battles.tuning_id 付け替え + tuning_name 明示更新 / deck_tunings の deck_id
--              移管 / 同名衝突 dup tuning は DELETE
--   5. Step D: duplicate deck を is_archived=true、name も clean 名に揃える
--   6. Step E: 残った全 decks.name を clean 名に UPDATE (active / archived 両方)
--   7. Step F: 残った全 battles.my_deck_name を decks.name から再同期
--   8. Step G: ログテーブル hardening (ENABLE RLS + REVOKE FROM PUBLIC/anon/authenticated
--              + GRANT SELECT TO service_role)
--   9. handle_new_user() を空白削除入りに CREATE OR REPLACE (multi-game + name_ja 優先 保持)
--  10. decks / battles に CHECK 制約追加 (内部空白禁止、統一パターン)
--  11. battles_normalize_deck_names trigger を ENABLE で戻す
--
-- transaction 境界:
--   本 migration は Supabase CLI が暗黙 transaction で実行する前提。trigger DISABLE/ENABLE
--   と大量 UPDATE は単一 transaction 内で完結する。失敗時は ROLLBACK で trigger 状態が
--   自動復旧する。staging 検証時に必ず確認すること (途中失敗 → ENABLE に戻ること)。
--   復旧不能の場合は docs/plans/...md §10.2.1 Troubleshooting を参照し、明示的に
--   `ALTER TABLE public.battles ENABLE TRIGGER battles_normalize_deck_names;` を実行する。
--
-- 統一空白パターン: '[[:space:]　​-‍﻿]'
--   = ASCII whitespace (POSIX [:space:]) + U+3000 全角スペース + U+200B〜U+200D zero-width
--     系 + U+FEFF BOM。PG の `\s` はデフォルトロケールで ASCII 空白のみで U+3000 を含まない
--     ため、明示クラスで書く必要がある (Step E/F の cleanup と Step 10 の CHECK 制約を一致
--     させないと、CHECK ADD で migration 全体失敗)。

-- =========================================================================
-- Step 0: trigger 一時無効化
-- =========================================================================
-- normalize_battle_deck_names() は ID 不変 UPDATE で NEW.my_deck_name := OLD.my_deck_name
-- し snapshot を守るが、本 migration では my_deck_name / tuning_name を明示書き換えする
-- ため、その期間だけ trigger を無効化する。named trigger のみ無効化 (USER 一括は他 trigger
-- に影響するので避ける)。
ALTER TABLE public.battles DISABLE TRIGGER battles_normalize_deck_names;

-- =========================================================================
-- Step A: 重複検出 + keeper 選定 → 永続ログテーブル
-- =========================================================================
-- 全 active decks の clean 名 (内部空白削除) を計算し、(user_id, game_title, format, cleaned_name)
-- でグルーピング。is_archived = false のみ対象 (archive 済みは別軸)。
-- keeper: 「clean 名前と完全一致 (= 元から空白なし) を最優先 → created_at 最古 → id 辞書順最小」
--
-- CTAS の AS 句に CTE を埋め込む形 (CREATE TABLE ... AS WITH ... SELECT ...) を使う。
-- `WITH ... CREATE TABLE ... AS SELECT ...` の順は PG では構文エラー。CTAS が外側に来る。
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
  '2026-05-18 deck whitespace cleanup の audit / 事故調査 / best effort 部分復旧用ログ。
   duplicate_id (archive された deck の id), keeper_id (battles が付け替えられた先の deck id),
   cleaned_name (clean 後の名前) を保持。per-row 情報は持たないため完全 rollback は不可。
   完全 rollback は migration 適用前の pg_dump / Supabase backup から restore する前提。
   service_role / postgres のみ参照可 (Step G で hardened)。';

-- =========================================================================
-- Step B: battles の my_deck_id / my_deck_name 付け替え
-- =========================================================================
UPDATE public.battles b
SET
  my_deck_id = m.keeper_id,
  my_deck_name = m.cleaned_name
FROM public._decks_merge_log_2026_05_18 m
WHERE b.my_deck_id = m.duplicate_id;

-- =========================================================================
-- Step C: tuning 統合 (battles.tuning_id 付け替え + deck_tunings 移管 / 削除)
-- =========================================================================
-- duplicate deck 配下の tuning と、keeper deck 配下の同名 tuning のマッピング。
-- tuning_merge を永続ログテーブルとして保存 (Step G で hardening)。
CREATE TABLE public._tunings_merge_log_2026_05_18 AS
WITH dup_tunings AS (
  SELECT
    dt.id AS dup_tuning_id,
    dt.deck_id AS dup_deck_id,
    dt.name AS dup_tuning_name,
    m.keeper_id
  FROM public.deck_tunings dt
  JOIN public._decks_merge_log_2026_05_18 m ON dt.deck_id = m.duplicate_id
),
keeper_tunings AS (
  SELECT
    kt.id AS keeper_tuning_id,
    kt.deck_id AS keeper_deck_id,
    kt.name AS keeper_tuning_name
  FROM public.deck_tunings kt
  WHERE kt.deck_id IN (SELECT keeper_id FROM public._decks_merge_log_2026_05_18)
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
  '2026-05-18 deck whitespace cleanup の tuning 統合 audit / best effort 部分復旧用ログ。
   dup_tuning_id (削除 or 移管された tuning id), keeper_tuning_id (battles 付け替え先、NULL
   なら deck_id move)、dup_deck_id / keeper_id, dup_tuning_name を保持。
   削除 tuning の sort_order / created_at / game_title は保持しないため完全 rollback は不可。
   service_role / postgres のみ参照可 (Step G で hardened)。';

-- C-1: 同名 tuning が keeper 側に存在する dup tuning → battles.tuning_id 付け替え + tuning_name 更新
UPDATE public.battles b
SET
  tuning_id = tm.keeper_tuning_id,
  tuning_name = (SELECT name FROM public.deck_tunings WHERE id = tm.keeper_tuning_id)
FROM public._tunings_merge_log_2026_05_18 tm
WHERE b.tuning_id = tm.dup_tuning_id AND tm.keeper_tuning_id IS NOT NULL;

-- C-2: keeper 側に同名 tuning が**ない** dup tuning → deck_id を keeper に move
-- deck_tunings_name_unique_idx (deck_id, lower(trim(name))) は keeper_tuning_id IS NULL の
-- 条件で除外しているので衝突しない (内部空白で別名扱いだった tuning は今回 scope 外)。
UPDATE public.deck_tunings dt
SET deck_id = tm.keeper_id
FROM public._tunings_merge_log_2026_05_18 tm
WHERE dt.id = tm.dup_tuning_id AND tm.keeper_tuning_id IS NULL;

-- C-3: 同名 tuning だった dup tuning は DELETE (battles はすでに C-1 で付け替え済み)
DELETE FROM public.deck_tunings dt
USING public._tunings_merge_log_2026_05_18 tm
WHERE dt.id = tm.dup_tuning_id AND tm.keeper_tuning_id IS NOT NULL;

-- =========================================================================
-- Step D: duplicate deck を is_archived=true、name も clean 名に揃える
-- =========================================================================
-- decks_active_name_unique_idx は WHERE is_archived = false の partial unique なので、
-- archive 化と name 変更を同時にやっても keeper と同名でも UNIQUE 衝突しない。
UPDATE public.decks
SET
  is_archived = true,
  name = regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g')  -- 追跡しやすさのため clean 名に揃える
  -- sort_order, created_at は保持 (audit / best effort 復旧時の手掛かりに)
WHERE id IN (SELECT duplicate_id FROM public._decks_merge_log_2026_05_18);

-- =========================================================================
-- Step E: 残った全 decks の name を clean に揃える (active + archived 両方)
-- =========================================================================
-- CHECK 制約 (Step 10) はテーブル全行を評価する。過去に手動 archive された /
-- 20260513000001 dedupe で archive された内部空白入り行が残っていると CHECK ADD で
-- migration 全体が失敗するため、is_archived フィルタを付けずに rename する。
-- partial unique なので archived 行が clean 後に keeper と同名になっても衝突しない。
UPDATE public.decks
SET name = regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g')
WHERE name <> regexp_replace(name, '[[:space:]　​-‍﻿]', '', 'g');

-- =========================================================================
-- Step F: 残った全 battles.my_deck_name を decks.name から再同期
-- =========================================================================
UPDATE public.battles b
SET my_deck_name = d.name
FROM public.decks d
WHERE b.my_deck_id = d.id
  AND b.my_deck_name <> d.name;

-- tuning_name 同期 (今回の migration では tuning rename はしていないが、Step C-2 で deck_id
-- 移動した tuning の name は変わらないので no-op。安全のため記述しておく)。
UPDATE public.battles b
SET tuning_name = t.name
FROM public.deck_tunings t
WHERE b.tuning_id = t.id
  AND b.tuning_name <> t.name;

-- =========================================================================
-- Step G: ログテーブル hardening
-- =========================================================================
-- アプリ利用者 (anon / authenticated) からの参照を完全に塞ぐ。
-- service_role は RLS は bypass するが table privilege は別問題のため、明示的に GRANT SELECT
-- を付与する (RLS bypass ≠ table privilege grant)。
-- RLS policy は作成しない = anon / authenticated は SELECT すら不可。
ALTER TABLE public._decks_merge_log_2026_05_18 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._decks_merge_log_2026_05_18 FROM PUBLIC;
REVOKE ALL ON TABLE public._decks_merge_log_2026_05_18 FROM anon, authenticated;
GRANT SELECT ON TABLE public._decks_merge_log_2026_05_18 TO service_role;

ALTER TABLE public._tunings_merge_log_2026_05_18 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._tunings_merge_log_2026_05_18 FROM PUBLIC;
REVOKE ALL ON TABLE public._tunings_merge_log_2026_05_18 FROM anon, authenticated;
GRANT SELECT ON TABLE public._tunings_merge_log_2026_05_18 TO service_role;

-- =========================================================================
-- Step 9: handle_new_user() を空白削除入りに CREATE OR REPLACE
-- =========================================================================
-- 現行 (20260510000002_handle_new_user_jp_names.sql) を踏襲: COALESCE(name_ja, name) で
-- 日本語表示名を優先、WHERE 句で dm/pokepoke の両ゲーム初期デッキを生成、ORDER BY を維持。
-- 本 migration の追加点は最終文字列に対する空白削除 (regexp_replace) のみ。
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Phase 1: profile 作成
  INSERT INTO public.profiles (id, display_name, is_guest)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.is_anonymous
  );

  -- Phase 2: 新規非ゲストユーザーに major decks 自動作成
  IF NOT NEW.is_anonymous THEN
    INSERT INTO public.decks (user_id, name, format, game_title, sort_order)
    SELECT
      NEW.id,
      regexp_replace(COALESCE(odm.name_ja, odm.name), '[[:space:]　​-‍﻿]', '', 'g'),  -- ★ 空白削除
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

-- function 自体への直接実行権限は不要 (trigger 経由でのみ呼ばれる SECURITY DEFINER)。
-- 既存 migration (20260509000004 / 20260510000002) で REVOKE 済みのため、本 migration では
-- CREATE OR REPLACE のみ。既存 grant 状態は保持される。

-- =========================================================================
-- Step 10: CHECK 制約追加 (内部空白禁止、統一パターン)
-- =========================================================================
-- 既存 length check は別観点の制約として併存。
-- 統一パターン '[[:space:]　​-‍﻿]' は Step A/E/F の regexp_replace と完全一致。
ALTER TABLE public.decks
  ADD CONSTRAINT decks_name_no_whitespace_check
  CHECK (name !~ '[[:space:]　​-‍﻿]');

ALTER TABLE public.battles
  ADD CONSTRAINT battles_my_deck_name_no_whitespace_check
  CHECK (my_deck_name !~ '[[:space:]　​-‍﻿]');

-- =========================================================================
-- Step 11: trigger 再有効化
-- =========================================================================
ALTER TABLE public.battles ENABLE TRIGGER battles_normalize_deck_names;
