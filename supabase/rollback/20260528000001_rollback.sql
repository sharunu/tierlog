-- Plan D / D-1 ロールバック: account_access_state(uuid) を削除
--
-- 注意: 本ロールバックは D-2 (書き込み系 RLS) / D-3 (SECDEF 関数) の
-- ロールバック適用後に流すこと。account_access_state が POLICY / RPC から
-- 参照されたまま DROP すると CASCADE で POLICY / 関数定義が消える。
--
-- 順序:
--   1. supabase/rollback/20260528000003_rollback.sql を流す (D-3 を旧定義に戻す)
--   2. supabase/rollback/20260528000002_rollback.sql を流す (D-2 を旧 POLICY に戻す)
--   3. 本 SQL を流す (D-1 関数を DROP)

DROP FUNCTION IF EXISTS public.account_access_state(uuid);
