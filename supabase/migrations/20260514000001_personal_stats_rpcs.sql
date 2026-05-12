-- PR7 Phase 7a (Phase 2 hardening): 個人統計の DB-side 集計 RPC を新設
--
-- 既存 getPersonalStats / getDetailedPersonalStats / getDeckDetailStats /
-- getOpponentDeckDetailStats (src/lib/actions/stats-actions.ts) が全 battles を取得 →
-- JS で集計しているのを DB 集計に切替えるための RPC。Phase 7a は RPC 追加のみで、
-- 旧 JS 集計コードは引き続き動作 (回帰なし)。Phase 7b で client 側を切替える。
--
-- 既存 global stats RPC (get_global_my_deck_stats_range 等) と同シグネチャの personal 版を新設。
-- 差分:
--   - auth.uid() 経由で本人 battles のみ集計 (p_user_id は取らない、oracle 危険)
--   - p_max_stage は不要 (Resolved Decision [p_max_stage]: 取らない)
--   - NULL date を許容 (getPersonalStats は全期間集計のため (NULL, NULL) を渡す)

-- =============================================================================
-- 1. get_personal_my_deck_stats_range
--    (現行 getDetailedPersonalStats の myDeckStats 部分相当、my_deck 軸集計)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_personal_my_deck_stats_range(
  p_start_date date,
  p_end_date date,
  p_format text
)
RETURNS TABLE (
  deck_name text, wins bigint, losses bigint, draws bigint, total bigint, win_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH battle_data AS (
    SELECT b.my_deck_name AS my_deck, b.result
    FROM public.battles b
    WHERE b.user_id = auth.uid()
      AND b.format = p_format
      AND (p_start_date IS NULL OR b.fought_at >= p_start_date)
      AND (p_end_date IS NULL OR b.fought_at < p_end_date + interval '1 day')
  ),
  agg AS (
    SELECT
      my_deck,
      COUNT(*) FILTER (WHERE result = 'win') AS w,
      COUNT(*) FILTER (WHERE result = 'loss') AS l,
      COUNT(*) FILTER (WHERE result = 'draw') AS d,
      COUNT(*) AS t
    FROM battle_data
    GROUP BY my_deck
  )
  SELECT
    a.my_deck AS deck_name,
    a.w, a.l, a.d, a.t,
    CASE WHEN (a.w + a.l) = 0 THEN NULL ELSE ROUND(a.w * 100.0 / (a.w + a.l), 0) END AS win_rate
  FROM agg a
  ORDER BY a.t DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_personal_my_deck_stats_range(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_personal_my_deck_stats_range(date, date, text) TO authenticated;

-- =============================================================================
-- 2. get_personal_opponent_deck_stats_range
--    (現行 getPersonalStats + getDetailedPersonalStats の opponentDeckStats 部分相当)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_personal_opponent_deck_stats_range(
  p_start_date date,
  p_end_date date,
  p_format text
)
RETURNS TABLE (
  deck_name text, wins bigint, losses bigint, draws bigint, total bigint, win_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH battle_data AS (
    SELECT b.opponent_deck_name AS opp_deck, b.result
    FROM public.battles b
    WHERE b.user_id = auth.uid()
      AND b.format = p_format
      AND (p_start_date IS NULL OR b.fought_at >= p_start_date)
      AND (p_end_date IS NULL OR b.fought_at < p_end_date + interval '1 day')
  ),
  agg AS (
    SELECT
      opp_deck,
      COUNT(*) FILTER (WHERE result = 'win') AS w,
      COUNT(*) FILTER (WHERE result = 'loss') AS l,
      COUNT(*) FILTER (WHERE result = 'draw') AS d,
      COUNT(*) AS t
    FROM battle_data
    GROUP BY opp_deck
  )
  SELECT
    a.opp_deck AS deck_name,
    a.w, a.l, a.d, a.t,
    CASE WHEN (a.w + a.l) = 0 THEN NULL ELSE ROUND(a.w * 100.0 / (a.w + a.l), 0) END AS win_rate
  FROM agg a
  ORDER BY a.t DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_personal_opponent_deck_stats_range(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_personal_opponent_deck_stats_range(date, date, text) TO authenticated;

-- =============================================================================
-- 3. get_personal_turn_order_stats_range
--    (現行 getDetailedPersonalStats の turn_order 部分相当、9 列の集計)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_personal_turn_order_stats_range(
  p_start_date date,
  p_end_date date,
  p_format text
)
RETURNS TABLE (
  first_wins bigint, first_losses bigint, first_draws bigint,
  second_wins bigint, second_losses bigint, second_draws bigint,
  unknown_wins bigint, unknown_losses bigint, unknown_draws bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'first'),
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'first'),
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'first'),
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'second'),
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'second'),
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'second'),
    COUNT(*) FILTER (WHERE b.result = 'win' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))),
    COUNT(*) FILTER (WHERE b.result = 'loss' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))),
    COUNT(*) FILTER (WHERE b.result = 'draw' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second')))
  FROM public.battles b
  WHERE b.user_id = auth.uid()
    AND b.format = p_format
    AND (p_start_date IS NULL OR b.fought_at >= p_start_date)
    AND (p_end_date IS NULL OR b.fought_at < p_end_date + interval '1 day');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_personal_turn_order_stats_range(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_personal_turn_order_stats_range(date, date, text) TO authenticated;

-- =============================================================================
-- 4. get_personal_deck_detail_stats_overall
--    (現行 getDeckDetailStats の overall (per-opponent) 部分相当)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_personal_deck_detail_stats_overall(
  p_deck_name text,
  p_format text,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  opponent_deck_name text,
  wins bigint, losses bigint, draws bigint, total bigint, win_rate numeric,
  first_wins bigint, first_losses bigint, first_draws bigint, first_total bigint,
  second_wins bigint, second_losses bigint, second_draws bigint, second_total bigint,
  unknown_wins bigint, unknown_losses bigint, unknown_draws bigint, unknown_total bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.opponent_deck_name,
    COUNT(*) FILTER (WHERE b.result = 'win') AS wins,
    COUNT(*) FILTER (WHERE b.result = 'loss') AS losses,
    COUNT(*) FILTER (WHERE b.result = 'draw') AS draws,
    COUNT(*) AS total,
    CASE WHEN (COUNT(*) FILTER (WHERE b.result IN ('win','loss'))) = 0 THEN NULL
         ELSE ROUND(COUNT(*) FILTER (WHERE b.result = 'win') * 100.0 / COUNT(*) FILTER (WHERE b.result IN ('win','loss')), 0)
    END AS win_rate,
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'first') AS first_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'first') AS first_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'first') AS first_draws,
    COUNT(*) FILTER (WHERE b.turn_order = 'first') AS first_total,
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'second') AS second_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'second') AS second_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'second') AS second_draws,
    COUNT(*) FILTER (WHERE b.turn_order = 'second') AS second_total,
    COUNT(*) FILTER (WHERE b.result = 'win' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_draws,
    COUNT(*) FILTER (WHERE b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second')) AS unknown_total
  FROM public.battles b
  WHERE b.user_id = auth.uid()
    AND b.my_deck_name = p_deck_name
    AND b.format = p_format
    AND (p_start_date IS NULL OR b.fought_at >= p_start_date)
    AND (p_end_date IS NULL OR b.fought_at < p_end_date + interval '1 day')
  GROUP BY b.opponent_deck_name
  ORDER BY COUNT(*) DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_personal_deck_detail_stats_overall(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_personal_deck_detail_stats_overall(text, text, date, date) TO authenticated;

-- =============================================================================
-- 5. get_personal_deck_detail_stats_by_tuning
--    (現行 getDeckDetailStats の tuningStats[].opponents[] 部分相当)
--    per-(tuning_name × opponent_deck_name) 単位の集計
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_personal_deck_detail_stats_by_tuning(
  p_deck_name text,
  p_format text,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  tuning_name text,
  opponent_deck_name text,
  wins bigint, losses bigint, draws bigint, total bigint, win_rate numeric,
  first_wins bigint, first_losses bigint, first_draws bigint, first_total bigint,
  second_wins bigint, second_losses bigint, second_draws bigint, second_total bigint,
  unknown_wins bigint, unknown_losses bigint, unknown_draws bigint, unknown_total bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(b.tuning_name, '指定なし')::text AS tuning_name,
    b.opponent_deck_name,
    COUNT(*) FILTER (WHERE b.result = 'win') AS wins,
    COUNT(*) FILTER (WHERE b.result = 'loss') AS losses,
    COUNT(*) FILTER (WHERE b.result = 'draw') AS draws,
    COUNT(*) AS total,
    CASE WHEN (COUNT(*) FILTER (WHERE b.result IN ('win','loss'))) = 0 THEN NULL
         ELSE ROUND(COUNT(*) FILTER (WHERE b.result = 'win') * 100.0 / COUNT(*) FILTER (WHERE b.result IN ('win','loss')), 0)
    END AS win_rate,
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'first') AS first_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'first') AS first_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'first') AS first_draws,
    COUNT(*) FILTER (WHERE b.turn_order = 'first') AS first_total,
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'second') AS second_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'second') AS second_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'second') AS second_draws,
    COUNT(*) FILTER (WHERE b.turn_order = 'second') AS second_total,
    COUNT(*) FILTER (WHERE b.result = 'win' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_draws,
    COUNT(*) FILTER (WHERE b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second')) AS unknown_total
  FROM public.battles b
  WHERE b.user_id = auth.uid()
    AND b.my_deck_name = p_deck_name
    AND b.format = p_format
    AND (p_start_date IS NULL OR b.fought_at >= p_start_date)
    AND (p_end_date IS NULL OR b.fought_at < p_end_date + interval '1 day')
  GROUP BY COALESCE(b.tuning_name, '指定なし'), b.opponent_deck_name
  ORDER BY COALESCE(b.tuning_name, '指定なし'), COUNT(*) DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_personal_deck_detail_stats_by_tuning(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_personal_deck_detail_stats_by_tuning(text, text, date, date) TO authenticated;

-- =============================================================================
-- 6. get_personal_opponent_deck_detail_stats
--    (現行 getOpponentDeckDetailStats 相当、per-my_deck 集計)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_personal_opponent_deck_detail_stats(
  p_opponent_deck_name text,
  p_format text,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  my_deck_name text,
  wins bigint, losses bigint, draws bigint, total bigint, win_rate numeric,
  first_wins bigint, first_losses bigint, first_draws bigint, first_total bigint,
  second_wins bigint, second_losses bigint, second_draws bigint, second_total bigint,
  unknown_wins bigint, unknown_losses bigint, unknown_draws bigint, unknown_total bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.my_deck_name,
    COUNT(*) FILTER (WHERE b.result = 'win') AS wins,
    COUNT(*) FILTER (WHERE b.result = 'loss') AS losses,
    COUNT(*) FILTER (WHERE b.result = 'draw') AS draws,
    COUNT(*) AS total,
    CASE WHEN (COUNT(*) FILTER (WHERE b.result IN ('win','loss'))) = 0 THEN NULL
         ELSE ROUND(COUNT(*) FILTER (WHERE b.result = 'win') * 100.0 / COUNT(*) FILTER (WHERE b.result IN ('win','loss')), 0)
    END AS win_rate,
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'first') AS first_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'first') AS first_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'first') AS first_draws,
    COUNT(*) FILTER (WHERE b.turn_order = 'first') AS first_total,
    COUNT(*) FILTER (WHERE b.result = 'win' AND b.turn_order = 'second') AS second_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND b.turn_order = 'second') AS second_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND b.turn_order = 'second') AS second_draws,
    COUNT(*) FILTER (WHERE b.turn_order = 'second') AS second_total,
    COUNT(*) FILTER (WHERE b.result = 'win' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_wins,
    COUNT(*) FILTER (WHERE b.result = 'loss' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_losses,
    COUNT(*) FILTER (WHERE b.result = 'draw' AND (b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second'))) AS unknown_draws,
    COUNT(*) FILTER (WHERE b.turn_order IS NULL OR b.turn_order NOT IN ('first', 'second')) AS unknown_total
  FROM public.battles b
  WHERE b.user_id = auth.uid()
    AND b.opponent_deck_name = p_opponent_deck_name
    AND b.format = p_format
    AND (p_start_date IS NULL OR b.fought_at >= p_start_date)
    AND (p_end_date IS NULL OR b.fought_at < p_end_date + interval '1 day')
  GROUP BY b.my_deck_name
  ORDER BY COUNT(*) DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_personal_opponent_deck_detail_stats(text, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_personal_opponent_deck_detail_stats(text, text, date, date) TO authenticated;
