-- PR4 (Phase 2 hardening): anon grants 監査 + PUBLIC EXECUTE 撤去 + 必要関数のみ再 GRANT
--
-- 単純な `REVOKE ... FROM anon` だけでは PUBLIC ロール経由で anon が EXECUTE できる経路が残る
-- (has_function_privilege('anon', oid, 'EXECUTE') は PUBLIC grant 経由でも true)。
-- 本 migration は:
--   1. anon の直接 table/sequence grant を REVOKE
--   2. REVOKE ALL ON ALL FUNCTIONS ... FROM PUBLIC, anon で PUBLIC 経由 EXECUTE 経路を塞ぐ
--      (authenticated/service_role の既存 GRANT は touch しない)
--   3. authenticated が必要とする関数のみ明示 GRANT (念押し再宣言)
--   4. DEFAULT PRIVILEGES の PUBLIC + anon を REVOKE (今後の CREATE FUNCTION で自動付与しない)

-- ===== 監査 SQL (apply 前に staging で実行、結果は plan 本文の preflight 節に従う) =====
--
--   -- a) table / sequence の anon 直接 grant
--   SELECT n.nspname, c.relname, array_agg(p.privilege_type ORDER BY p.privilege_type) AS privs
--   FROM information_schema.table_privileges p
--   JOIN pg_class c ON c.relname = p.table_name
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE p.grantee = 'anon' AND n.nspname = 'public'
--   GROUP BY n.nspname, c.relname;
--
--   -- b) function EXECUTE (anon が直接 OR PUBLIC 経由でも EXECUTE 可な関数を全列挙)
--   SELECT n.nspname, p.proname, p.oid::regprocedure AS sig,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND has_function_privilege('anon', p.oid, 'EXECUTE') = true
--   ORDER BY p.proname;
--   -- 期待 (apply 後): (a) も (b) も 0 行
--   -- かつ step 3 で GRANT した関数が has_function_privilege('authenticated', oid, 'EXECUTE') = true

-- ===== step 1: anon の table / sequence REVOKE =====
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- ===== step 2: PUBLIC + anon の function EXECUTE を ALL FUNCTIONS で REVOKE =====
-- PUBLIC 経由 EXECUTE 経路を塞ぐのが目的。authenticated/service_role の既存 GRANT は touch しない。
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- ===== step 3: authenticated に必要な関数のみ EXECUTE を明示 GRANT (念押し再宣言) =====
-- ※ apply_limitless_snapshot / mark_limitless_sync_error は server-side service_role 限定なので
--   ここでは GRANT しない (既存 service_role GRANT が維持される)。

-- ----- (3-a) 書き込み / 状態変更 RPC -----
GRANT EXECUTE ON FUNCTION public.auto_add_opponent_deck(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_display_name(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_x_connection() TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_my_x_connection() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_opponent_decks(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_stage(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_detection_scan() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_quality_scoring(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_quality_score(uuid) TO authenticated;

-- ----- (3-b) 読み込み系: global / team / environment / suggestion / member 系 -----
GRANT EXECUTE ON FUNCTION public.get_global_my_deck_stats_range(date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_opponent_deck_stats_range(date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_turn_order_stats_range(date, date, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_deck_detail_stats(text, text, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_opponent_deck_detail_stats(text, text, date, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_my_deck_stats_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_stats_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_turn_order_stats_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_deck_trend_range(uuid, uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_deck_detail_stats(uuid, text, text, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_detail_stats(uuid, text, text, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_deck_trend_range(date, date, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_environment_deck_shares(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_environment_deck_shares_range(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_environment_shares_range(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_opponent_deck_suggestions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_member_summaries(uuid) TO authenticated;

-- ----- (3-c) RLS policy 内で参照される SECDEF function -----
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_team_member(uuid) TO authenticated;

-- ===== step 4: DEFAULT PRIVILEGES の PUBLIC + anon を REVOKE =====
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

-- 注: 公開共有ページ (/share/[id]) と OGP route (/api/og/[id]) は server-side service_role で読み取り済。
--     anon に対する公開読み取りが必要な経路はない。
