-- PR3 (2/2): is_team_member membership oracle 縮小 + 自己限定 wrapper 新設
--
-- 背景:
--   既存 `is_team_member(p_team_id uuid, p_user_id uuid)` は任意の (team_id, user_id) ペアを
--   引数に取れる SECURITY DEFINER 関数で、authenticated に EXECUTE 付与されているため、
--   REST `/rest/v1/rpc/is_team_member?p_team_id=...&p_user_id=...` 経由で他ユーザーの所属を
--   問い合わせられる membership oracle になっている。
--   (PUBLIC/anon は 20260424000001 で REVOKE 済、authenticated だけ未対応)
--
-- 設計方針:
--   1. `is_my_team_member(p_team_id uuid)` を新設し、内部で `auth.uid()` を使って
--      現在ログイン中ユーザーだけを判定する自己限定 wrapper にする。
--   2. team_members / teams の RLS policy を `is_team_member(team_id, auth.uid())` から
--      `is_my_team_member(team_id)` に置き換える。
--   3. 既存 `is_team_member(uuid, uuid)` の authenticated 直 EXECUTE を REVOKE する。
--      内部 SECDEF 関数 (Team RPC 8 本: get_team_*) からの呼び出しは関数 owner 権限で動くため
--      authenticated REVOKE 後も動作維持される。
--
-- 影響範囲 (staging で要確認):
--   - team_members / teams の SELECT (チーム一覧 / メンバー一覧表示)
--   - Team RPC 8 本: get_team_my_deck_stats_range / get_team_opponent_deck_stats_range /
--     get_team_deck_detail_stats / get_team_opponent_deck_detail_stats /
--     get_team_turn_order_stats_range / get_team_member_summaries / get_team_deck_trend_range /
--     get_team_members (これらは SECDEF 内部で is_team_member(team_id, auth.uid()) を呼ぶ
--     ガード句を持つ — owner 権限で評価されるので REVOKE 後も機能維持)
--
-- 参考: 20260424000001_security_hardening_additive.sql で is_team_member 本体を
-- SET search_path = '' + public.team_members 修飾版に上書き済、REVOKE PUBLIC, anon 済。
-- 本 migration は authenticated への REVOKE を追加する。


-- =============================================================================
-- 1. is_my_team_member(p_team_id) 自己限定 wrapper を新設
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_my_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_my_team_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_team_member(uuid) TO authenticated;


-- =============================================================================
-- 2. team_members / teams の RLS policy を is_my_team_member に切り替え
--    PR2 (20260511000003) で `is_team_member(team_id, (SELECT auth.uid()))` に書き換えた
--    policy を、自己限定 wrapper 呼び出しに更に切り替える。
-- =============================================================================

DROP POLICY IF EXISTS "Team members can read team members" ON public.team_members;
CREATE POLICY "Team members can read team members"
  ON public.team_members FOR SELECT
  USING (public.is_my_team_member(team_id));

DROP POLICY IF EXISTS "Team members can read team" ON public.teams;
CREATE POLICY "Team members can read team"
  ON public.teams FOR SELECT
  USING (public.is_my_team_member(id));


-- =============================================================================
-- 3. 既存 is_team_member(uuid, uuid) の authenticated 直 EXECUTE を REVOKE
--    Team RPC 8 本 (20260424000001 で is_team_member ガード + search_path = '' 済) の
--    内部呼び出しは SECDEF owner 権限で評価されるため、authenticated REVOKE 後も維持される。
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) FROM authenticated;


-- =============================================================================
-- ロールバック用 SQL (必要時に手動で流す):
--
--   -- 3. authenticated に EXECUTE を戻す
--   GRANT EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) TO authenticated;
--
--   -- 2. RLS policy を is_team_member(team_id, auth.uid()) に戻す (PR2 適用後の状態)
--   DROP POLICY IF EXISTS "Team members can read team members" ON public.team_members;
--   CREATE POLICY "Team members can read team members" ON public.team_members
--     FOR SELECT USING (public.is_team_member(team_id, (SELECT auth.uid())));
--
--   DROP POLICY IF EXISTS "Team members can read team" ON public.teams;
--   CREATE POLICY "Team members can read team" ON public.teams
--     FOR SELECT USING (public.is_team_member(id, (SELECT auth.uid())));
--
--   -- 1. is_my_team_member 自己限定 wrapper を削除
--   DROP FUNCTION IF EXISTS public.is_my_team_member(uuid);
-- =============================================================================
