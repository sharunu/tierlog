-- PR1: Supabase Advisor `unindexed_foreign_keys` 警告 8 件への対応
--
-- 背景:
--   Supabase Performance Lint で以下 8 個の FK 制約に covering index が無いと検出された。
--   FK 結合性能の改善のため、すべて btree index を追加する。
--   production / staging 両 DB で同一の 8 件が検出されており (Advisor CSV `(3).csv` で確認済)、
--   どちらに適用しても対象は変わらない。
--
-- 対応 FK:
--   - detection_alerts(resolved_by) -> profiles(id)
--   - detection_alerts(user_id) -> profiles(id)
--   - feedback(user_id) -> auth.users(id)
--   - quality_admin_bonus(granted_by) -> profiles(id)
--   - shares(user_id) -> profiles(id)
--   - team_members(user_id) -> profiles(id) (※ UNIQUE(team_id, user_id) は team_id 先頭の複合 index で user_id 単独 lookup を cover できない)
--   - user_stage_history(changed_by) -> profiles(id)
--   - user_stage_history(user_id) -> profiles(id)
--
-- 設計原則:
--   - 通常の `CREATE INDEX` は `SHARE` lock を取り並列の INSERT/UPDATE/DELETE をブロックし得る
--     (`CONCURRENTLY` は migration トランザクション内では使用不可)。
--     公開前でデータ量が小さいため低リスクだが、production 適用は低トラフィック時に実施する。
--   - すべて `IF NOT EXISTS` で冪等化、再適用しても no-op。
--   - index 名は `<table>_<column>_idx` で統一。

CREATE INDEX IF NOT EXISTS detection_alerts_resolved_by_idx
  ON public.detection_alerts(resolved_by);

CREATE INDEX IF NOT EXISTS detection_alerts_user_id_idx
  ON public.detection_alerts(user_id);

CREATE INDEX IF NOT EXISTS feedback_user_id_idx
  ON public.feedback(user_id);

CREATE INDEX IF NOT EXISTS quality_admin_bonus_granted_by_idx
  ON public.quality_admin_bonus(granted_by);

CREATE INDEX IF NOT EXISTS shares_user_id_idx
  ON public.shares(user_id);

CREATE INDEX IF NOT EXISTS team_members_user_id_idx
  ON public.team_members(user_id);

CREATE INDEX IF NOT EXISTS user_stage_history_changed_by_idx
  ON public.user_stage_history(changed_by);

CREATE INDEX IF NOT EXISTS user_stage_history_user_id_idx
  ON public.user_stage_history(user_id);

-- ロールバック用 SQL (必要時に手動で流す):
--
--   DROP INDEX IF EXISTS public.detection_alerts_resolved_by_idx;
--   DROP INDEX IF EXISTS public.detection_alerts_user_id_idx;
--   DROP INDEX IF EXISTS public.feedback_user_id_idx;
--   DROP INDEX IF EXISTS public.quality_admin_bonus_granted_by_idx;
--   DROP INDEX IF EXISTS public.shares_user_id_idx;
--   DROP INDEX IF EXISTS public.team_members_user_id_idx;
--   DROP INDEX IF EXISTS public.user_stage_history_changed_by_idx;
--   DROP INDEX IF EXISTS public.user_stage_history_user_id_idx;
