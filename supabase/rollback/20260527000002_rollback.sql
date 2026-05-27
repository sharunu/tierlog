-- Rollback for 20260527000002_c1_team_member_summaries_game_scope.sql (Plan C C-1)
-- 旧定義 (20260424000001:375) に戻す: team の game_title フィルタを撤去し、
-- battles を user_id だけで集計する状態へ。

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
  LEFT JOIN public.battles b ON b.user_id = tm.user_id
  WHERE tm.team_id = p_team_id
    AND tm.hidden_at IS NULL
  GROUP BY tm.user_id, tm.discord_username
  ORDER BY COALESCE(COUNT(b.id), 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_member_summaries(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_member_summaries(uuid) TO authenticated;
