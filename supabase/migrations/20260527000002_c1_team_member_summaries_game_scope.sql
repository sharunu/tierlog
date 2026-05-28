-- Plan C C-1: get_team_member_summaries の game scope 修正
--
-- 背景:
--   `teams` は (discord_guild_id, game_title) UNIQUE で dm/pokepoke 別 team として分離されているが、
--   `get_team_member_summaries(p_team_id)` は battles を user_id だけで集約し、
--   teams.game_title でフィルタしていなかった。
--   → 同一ユーザーの dm/pokepoke 両方の battles がチームメンバー概要で混入していた。
--
-- 設計 (RD-C4):
--   team_members → teams JOIN で teams.game_title を解決し、
--   battles.game_title = teams.game_title を AND する。
--   呼び出し側 (src/lib/actions/team-actions.ts:174) の引数追加は不要。
--   既存の is_team_member 権限チェックと tm.hidden_at IS NULL フィルタは維持。
--
-- 既存規約準拠:
--   SECURITY DEFINER + SET search_path = '' + public. 修飾
--   (20260424000001 / 20260509000004 と同パターン)
--
-- 戻り型・grant は変更しないため、20260509000004 / 20260512000001 で設定済みの
-- REVOKE ALL ... FROM PUBLIC, anon, service_role / GRANT EXECUTE TO authenticated は
-- そのまま有効。再 GRANT は不要だが、念のため末尾で確認 GRANT を入れる。

CREATE OR REPLACE FUNCTION public.get_team_member_summaries(p_team_id uuid)
RETURNS TABLE (
  user_id uuid,
  discord_username text,
  wins bigint,
  losses bigint,
  draws bigint,
  total bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_team_member(p_team_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a team member' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    tm.user_id,
    tm.discord_username,
    COALESCE(COUNT(*) FILTER (WHERE b.result = 'win'), 0) AS wins,
    COALESCE(COUNT(*) FILTER (WHERE b.result = 'loss'), 0) AS losses,
    COALESCE(COUNT(*) FILTER (WHERE b.result = 'draw'), 0) AS draws,
    COALESCE(COUNT(b.id), 0) AS total
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  LEFT JOIN public.battles b
    ON b.user_id = tm.user_id
    AND b.game_title = t.game_title  -- Plan C C-1: team の game_title と一致する battles のみ集計
  WHERE tm.team_id = p_team_id
    AND tm.hidden_at IS NULL
  GROUP BY tm.user_id, tm.discord_username
  ORDER BY COALESCE(COUNT(b.id), 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_member_summaries(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_member_summaries(uuid) TO authenticated;
