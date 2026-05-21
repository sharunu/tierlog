-- deck_tunings の論理削除化 (battles スナップショット破壊バグ修正)
--
-- 背景:
--   deleteTuning() が deck_tunings を物理 DELETE していたため、battles.tuning_id
--   (FK: deck_tunings(id) ON DELETE SET NULL) が DB 側で NULL 化される。この battles
--   UPDATE が battles_normalize_deck_names トリガを発火させ、tuning_id が変化した
--   UPDATE では OLD 名保持分岐をスキップして my_deck_name / tuning_name を
--   decks / deck_tunings から再正規化してしまう。結果、過去戦績の my_deck_name が
--   デッキ改名後の現在名に置換され、tuning_name は NULL に上書きされる。
--
-- 本マイグレーションは追加専用 (expand)。現在稼働中の prod コードを壊さない:
--   - is_archived を DEFAULT false で追加 → 既存行は全て active
--   - 一意制約を「active な tuning のみ」を対象とする partial index へ張り替え
--     (decks_active_name_unique_idx と同じ方式 / 20260513000001_unique_decks_and_tunings.sql)

-- 1. is_archived 列追加
ALTER TABLE public.deck_tunings
  ADD COLUMN is_archived boolean NOT NULL DEFAULT false;

-- 2. 一意 index を partial 化
--    旧 (20260513000001_unique_decks_and_tunings.sql:85-86): UNIQUE (deck_id, lower(trim(name)))  -- 全行対象
--    新:                        UNIQUE (deck_id, lower(trim(name))) WHERE is_archived = false
--    → アーカイブ済み tuning と同名の active tuning を再作成可能にする
--      (decks_active_name_unique_idx と同じ挙動)
--    適用時点では全行 is_archived=false かつ旧 index で一意性が保証済みのため、
--    重複解消処理 (20260513000001 が行ったような dedupe) は不要。
DROP INDEX IF EXISTS public.deck_tunings_name_unique_idx;
CREATE UNIQUE INDEX deck_tunings_name_unique_idx
  ON public.deck_tunings (deck_id, lower(trim(name)))
  WHERE is_archived = false;
