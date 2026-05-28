-- Plan C C-2: detection 関数の p_game_title 必須 overload 追加
--
-- 背景:
--   detect_extreme_winrate / detect_rapid_input / detect_repetitive_pattern は
--   `p_params jsonb` のみで game_title フィルタなし。
--   `FROM public.battles b` のみで、user 単位の全 game 横断集計で異常判定をかける。
--   結果: ポケポケ専用 user の異常勝率が dm 側 admin UI で「dm として」誤検出される、
--   dm/pokepoke 両方プレイするユーザーは合算で擬陽性が増える。
--
-- 設計 (RD-C7 / RD-C8):
--   - 各 detect_* に `(p_params jsonb, p_game_title text)` の新 overload を追加 (必須引数、default なし)。
--   - 関数本体に `AND b.game_title = p_game_title` および
--     NOT EXISTS 内に `AND da.game_title = p_game_title` を AND し、game 別に dedup する (RD-C1)。
--   - 旧 overload (`p_params jsonb` のみ) は本 plan では DROP しない (互換性のため一時保持)。
--     ただし COMMENT で DEPRECATED + Phase 2 DROP 対象と明記、runner からは参照しない (C-3 で切替)。
--   - RETURNS TABLE は既存と同じ (user_id uuid, rule_key text, details jsonb) の 3 列。
--   - SECURITY DEFINER + SET search_path = '' + public. 修飾 (既存規約準拠)。
--   - REVOKE ALL FROM PUBLIC, anon, authenticated / GRANT EXECUTE TO service_role
--     (旧 overload と同 grant 戦略。runner は所有者ロールで呼ぶため EXECUTE 不要だが、
--     admin / 検証用に service_role からは呼べる状態を維持)。

-- =============================================================================
-- 1. detect_extreme_winrate (新 overload: p_game_title 必須)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.detect_extreme_winrate(
  p_params jsonb,
  p_game_title text
)
RETURNS TABLE (user_id uuid, rule_key text, details jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_period_days integer := (p_params->>'period_days')::integer;
  v_min_battles integer := (p_params->>'min_battles')::integer;
  v_max_winrate numeric := (p_params->>'max_winrate')::numeric;
  v_min_winrate numeric := (p_params->>'min_winrate')::numeric;
BEGIN
  RETURN QUERY
  SELECT
    b.user_id,
    'extreme_winrate'::text AS rule_key,
    jsonb_build_object(
      'total_battles', COUNT(*),
      'wins', COUNT(*) FILTER (WHERE b.result = 'win'),
      'win_rate', ROUND(COUNT(*) FILTER (WHERE b.result = 'win') * 1.0 / COUNT(*), 4),
      'period_days', v_period_days,
      'game_title', p_game_title
    ) AS details
  FROM public.battles b
  JOIN public.profiles p ON p.id = b.user_id
  WHERE p.stage IN (1, 2, 3)
    AND b.fought_at >= (now() - (v_period_days || ' days')::interval)
    AND b.game_title = p_game_title  -- Plan C C-2: game scope
    AND NOT EXISTS (
      SELECT 1 FROM public.detection_alerts da
      WHERE da.user_id = b.user_id
        AND da.rule_key = 'extreme_winrate'
        AND da.game_title = p_game_title  -- Plan C C-2: 既解決判定も game 別
        AND da.is_resolved = false
    )
  GROUP BY b.user_id
  HAVING COUNT(*) >= v_min_battles
    AND (
      COUNT(*) FILTER (WHERE b.result = 'win') * 1.0 / COUNT(*) >= v_max_winrate
      OR COUNT(*) FILTER (WHERE b.result = 'win') * 1.0 / COUNT(*) <= v_min_winrate
    );
END;
$$;
REVOKE ALL ON FUNCTION public.detect_extreme_winrate(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_extreme_winrate(jsonb, text) TO service_role;

COMMENT ON FUNCTION public.detect_extreme_winrate(jsonb)
IS 'DEPRECATED in Plan C (2026-05-27): old single-arg overload retained for compatibility only. '
   'The runner (_run_detection_scan_internal) calls the 2-arg overload (p_params, p_game_title). '
   'Scheduled for DROP in Phase 2 after pg_proc / pg_depend confirms no remaining callers.';

-- =============================================================================
-- 2. detect_rapid_input (新 overload: p_game_title 必須)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.detect_rapid_input(
  p_params jsonb,
  p_game_title text
)
RETURNS TABLE (user_id uuid, rule_key text, details jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_hours integer := (p_params->>'window_hours')::integer;
  v_max_battles integer := (p_params->>'max_battles')::integer;
  v_period_hours integer := COALESCE((p_params->>'period_hours')::integer, 24);
BEGIN
  v_period_hours := GREATEST(v_period_hours, v_window_hours);

  RETURN QUERY
  WITH windowed AS (
    SELECT
      b.user_id,
      b.fought_at,
      COUNT(*) OVER (
        PARTITION BY b.user_id
        ORDER BY b.fought_at
        RANGE BETWEEN make_interval(hours => v_window_hours) PRECEDING AND CURRENT ROW
      ) AS window_count
    FROM public.battles b
    JOIN public.profiles p ON p.id = b.user_id
    WHERE p.stage IN (1, 2, 3)
      AND b.fought_at >= now() - make_interval(hours => v_period_hours)
      AND b.game_title = p_game_title  -- Plan C C-2: game scope
      AND NOT EXISTS (
        SELECT 1 FROM public.detection_alerts da
        WHERE da.user_id = b.user_id
          AND da.rule_key = 'rapid_input'
          AND da.game_title = p_game_title  -- Plan C C-2: 既解決判定も game 別
          AND da.is_resolved = false
      )
  )
  SELECT DISTINCT ON (w.user_id)
    w.user_id,
    'rapid_input'::text AS rule_key,
    jsonb_build_object(
      'peak_window_end', w.fought_at,
      'peak_window_count', w.window_count,
      'window_hours', v_window_hours,
      'period_hours', v_period_hours,
      'threshold', v_max_battles,
      'game_title', p_game_title
    ) AS details
  FROM windowed w
  WHERE w.window_count >= v_max_battles
  ORDER BY w.user_id, w.window_count DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.detect_rapid_input(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_rapid_input(jsonb, text) TO service_role;

COMMENT ON FUNCTION public.detect_rapid_input(jsonb)
IS 'DEPRECATED in Plan C (2026-05-27): old single-arg overload retained for compatibility only. '
   'The runner (_run_detection_scan_internal) calls the 2-arg overload (p_params, p_game_title). '
   'Scheduled for DROP in Phase 2 after pg_proc / pg_depend confirms no remaining callers.';

-- =============================================================================
-- 3. detect_repetitive_pattern (新 overload: p_game_title 必須)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.detect_repetitive_pattern(
  p_params jsonb,
  p_game_title text
)
RETURNS TABLE (user_id uuid, rule_key text, details jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max_consecutive integer := (p_params->>'max_consecutive')::integer;
  v_period_days integer := COALESCE((p_params->>'period_days')::integer, 1);
BEGIN
  RETURN QUERY
  WITH numbered AS (
    SELECT
      b.user_id,
      b.opponent_deck_name,
      b.result,
      b.fought_at,
      ROW_NUMBER() OVER (PARTITION BY b.user_id ORDER BY b.fought_at) -
      ROW_NUMBER() OVER (PARTITION BY b.user_id, b.opponent_deck_name, b.result ORDER BY b.fought_at) AS grp
    FROM public.battles b
    JOIN public.profiles p ON p.id = b.user_id
    WHERE p.stage IN (1, 2, 3)
      AND b.fought_at >= now() - make_interval(days => v_period_days)
      AND b.game_title = p_game_title  -- Plan C C-2: game scope
      AND NOT EXISTS (
        SELECT 1 FROM public.detection_alerts da
        WHERE da.user_id = b.user_id
          AND da.rule_key = 'repetitive_pattern'
          AND da.game_title = p_game_title  -- Plan C C-2: 既解決判定も game 別
          AND da.is_resolved = false
      )
  ),
  streaks AS (
    SELECT
      n.user_id,
      n.opponent_deck_name,
      n.result,
      COUNT(*) AS streak_len
    FROM numbered n
    GROUP BY n.user_id, n.opponent_deck_name, n.result, n.grp
    HAVING COUNT(*) >= v_max_consecutive
  )
  SELECT
    s.user_id,
    'repetitive_pattern'::text AS rule_key,
    jsonb_build_object(
      'opponent_deck', s.opponent_deck_name,
      'result', s.result,
      'consecutive_count', s.streak_len,
      'threshold', v_max_consecutive,
      'period_days', v_period_days,
      'game_title', p_game_title
    ) AS details
  FROM streaks s;
END;
$$;
REVOKE ALL ON FUNCTION public.detect_repetitive_pattern(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_repetitive_pattern(jsonb, text) TO service_role;

COMMENT ON FUNCTION public.detect_repetitive_pattern(jsonb)
IS 'DEPRECATED in Plan C (2026-05-27): old single-arg overload retained for compatibility only. '
   'The runner (_run_detection_scan_internal) calls the 2-arg overload (p_params, p_game_title). '
   'Scheduled for DROP in Phase 2 after pg_proc / pg_depend confirms no remaining callers.';
