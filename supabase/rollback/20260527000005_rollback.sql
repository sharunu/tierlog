-- Rollback for 20260527000005_c4_c5_quality_scoring_game_scope.sql (Plan C C-4 + C-5)
--
-- 旧定義 (20260509000001 ベース) に戻す。逆順:
--   step 7 → step 6 → step 5 → step 4 → step 3 → step 2 → step 1
--
-- 注意:
--   - 旧 (user_id) UNIQUE 制約は ADD CONSTRAINT で明示的に
--     `quality_score_snapshots_user_id_key` という名前で復元する
--     (20260414000001 で `UNIQUE(user_id)` 列レベル指定したときの自動命名と一致)。
--   - rollback 適用後は user × game の snapshot が 1 行に潰れるため、game_title 列 DROP 前に
--     重複行が存在しないことを確認する必要がある。`DELETE FROM ... WHERE game_title != 'dm'`
--     で pokepoke 側 snapshot を消すか、preflight count を取った上で本 rollback を流す。
--     簡易版として本 rollback では DELETE WHERE game_title != 'dm' を組み込む
--     (元のスキーマでは pokepoke の snapshot は存在し得ない)。

-- =============================================================================
-- step 7 / 6 / 5 / 4 の逆順: quality scoring 関数を旧定義に戻す
-- =============================================================================

-- calculate_quality_score(p_user_id) wrapper は signature 変更なしのため
-- 内部実装に依存。step 5 の旧 overload 差し戻しを行う前に再定義する必要なし。

-- step 6 (旧): _run_quality_scoring_internal(p_auto_update) を旧定義に戻す
CREATE OR REPLACE FUNCTION public._run_quality_scoring_internal(p_auto_update boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user record;
  v_result jsonb;
  v_total integer;
  v_threshold integer;
  v_promoted integer := 0;
  v_demoted integer := 0;
  v_calculated integer := 0;
BEGIN
  SELECT (value#>>'{}')::integer INTO v_threshold
  FROM public.quality_scoring_settings WHERE key = 'threshold';
  IF v_threshold IS NULL THEN v_threshold := 40; END IF;

  FOR v_user IN
    SELECT id, stage FROM public.profiles WHERE is_guest = false
  LOOP
    v_result := public._calculate_quality_score_internal(v_user.id);

    IF (v_result->>'eligible')::boolean THEN
      v_total := (v_result->>'total_score')::integer;

      INSERT INTO public.quality_score_snapshots (user_id, total_score, breakdown, calculated_at)
      VALUES (v_user.id, v_total, v_result->'breakdown', now())
      ON CONFLICT (user_id) DO UPDATE SET
        total_score = EXCLUDED.total_score,
        breakdown = EXCLUDED.breakdown,
        calculated_at = EXCLUDED.calculated_at;

      v_calculated := v_calculated + 1;

      IF p_auto_update THEN
        IF v_total >= v_threshold AND v_user.stage = 2 THEN
          UPDATE public.profiles SET stage = 1 WHERE id = v_user.id;
          INSERT INTO public.user_stage_history (user_id, from_stage, to_stage, reason, changed_by)
          VALUES (v_user.id, 2, 1, '品質スコア自動昇格 (score=' || v_total || ', threshold=' || v_threshold || ')', v_user.id);
          v_promoted := v_promoted + 1;
        ELSIF v_total < v_threshold AND v_user.stage = 1 THEN
          UPDATE public.profiles SET stage = 2 WHERE id = v_user.id;
          INSERT INTO public.user_stage_history (user_id, from_stage, to_stage, reason, changed_by)
          VALUES (v_user.id, 1, 2, '品質スコア自動降格 (score=' || v_total || ', threshold=' || v_threshold || ')', v_user.id);
          v_demoted := v_demoted + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'calculated', v_calculated,
    'promoted', v_promoted,
    'demoted', v_demoted,
    'threshold', v_threshold
  );
END;
$$;
REVOKE ALL ON FUNCTION public._run_quality_scoring_internal(boolean)
  FROM PUBLIC, anon, authenticated, service_role;

-- step 5 (旧): _calculate_quality_score_internal(p_user_id) 旧 overload を戻す
CREATE OR REPLACE FUNCTION public._calculate_quality_score_internal(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rule record;
  v_score integer := 0;
  v_breakdown jsonb := '{}';
  v_profile record;
  v_matches boolean;
  v_battle_count bigint;
  v_win_count bigint;
  v_admin_bonus integer;
  v_rate numeric;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id AND is_guest = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('total_score', 0, 'breakdown', '{}'::jsonb, 'eligible', false);
  END IF;

  FOR rule IN SELECT * FROM public.quality_scoring_rules WHERE is_enabled = true LOOP
    v_matches := false;
    CASE rule.rule_key
      WHEN 'x_linked' THEN
        v_matches := v_profile.x_user_id IS NOT NULL;
      WHEN 'discord_linked' THEN
        SELECT EXISTS (SELECT 1 FROM public.discord_connections WHERE user_id = p_user_id) INTO v_matches;
      WHEN 'throwaway_suspect' THEN
        v_matches := v_profile.created_at > now() - ((rule.params->>'max_days')::integer || ' days')::interval;
      WHEN 'long_term_user' THEN
        v_matches := v_profile.created_at <= now() - ((rule.params->>'min_days')::integer || ' days')::interval;
      WHEN 'recent_battles' THEN
        SELECT COUNT(*) INTO v_battle_count
        FROM public.battles
        WHERE user_id = p_user_id
          AND fought_at >= now() - ((rule.params->>'period_days')::integer || ' days')::interval;
        v_matches := v_battle_count >= (rule.params->>'min_battles')::integer;
      WHEN 'opponent_diversity' THEN
        WITH last_n AS (
          SELECT opponent_deck_name
          FROM public.battles
          WHERE user_id = p_user_id
          ORDER BY fought_at DESC
          LIMIT (rule.params->>'last_n_battles')::integer
        )
        SELECT COUNT(DISTINCT opponent_deck_name) INTO v_battle_count FROM last_n;
        v_matches := v_battle_count >= (rule.params->>'min_distinct')::integer;
      WHEN 'normal_winrate' THEN
        SELECT COUNT(*), COUNT(*) FILTER (WHERE result = 'win')
        INTO v_battle_count, v_win_count
        FROM public.battles WHERE user_id = p_user_id;
        IF v_battle_count >= (rule.params->>'min_battles')::integer THEN
          v_rate := v_win_count * 100.0 / v_battle_count;
          v_matches := v_rate >= (rule.params->>'min_rate')::numeric
                   AND v_rate <= (rule.params->>'max_rate')::numeric;
        END IF;
      WHEN 'normal_input_pace' THEN
        SELECT COUNT(*) INTO v_battle_count
        FROM public.battles
        WHERE user_id = p_user_id
          AND fought_at >= now() - ((rule.params->>'window_hours')::integer || ' hours')::interval;
        v_matches := v_battle_count >= (rule.params->>'min_battles')::integer
                 AND v_battle_count <= (rule.params->>'max_battles')::integer;
      WHEN 'unresolved_alerts' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.detection_alerts
          WHERE user_id = p_user_id AND is_resolved = false
        ) INTO v_matches;
      WHEN 'extreme_winrate_q' THEN
        SELECT COUNT(*), COUNT(*) FILTER (WHERE result = 'win')
        INTO v_battle_count, v_win_count
        FROM public.battles WHERE user_id = p_user_id;
        IF v_battle_count >= (rule.params->>'min_battles')::integer THEN
          v_rate := v_win_count * 100.0 / v_battle_count;
          v_matches := v_rate > (rule.params->>'high_rate')::numeric
                    OR v_rate < (rule.params->>'low_rate')::numeric;
        END IF;
      WHEN 'repetitive_pattern_q' THEN
        WITH numbered AS (
          SELECT
            opponent_deck_name, result, fought_at,
            ROW_NUMBER() OVER (ORDER BY fought_at) -
            ROW_NUMBER() OVER (PARTITION BY opponent_deck_name, result ORDER BY fought_at) AS grp
          FROM public.battles WHERE user_id = p_user_id
        ),
        streaks AS (
          SELECT COUNT(*) AS streak_len
          FROM numbered
          GROUP BY opponent_deck_name, result, grp
          HAVING COUNT(*) >= (rule.params->>'max_consecutive')::integer
        )
        SELECT EXISTS (SELECT 1 FROM streaks) INTO v_matches;
      WHEN 'excessive_input' THEN
        SELECT COUNT(*) INTO v_battle_count
        FROM public.battles
        WHERE user_id = p_user_id
          AND fought_at >= now() - ((rule.params->>'window_hours')::integer || ' hours')::interval;
        v_matches := v_battle_count >= (rule.params->>'max_battles')::integer;
      ELSE
        v_matches := false;
    END CASE;

    IF v_matches THEN
      v_score := v_score + rule.score;
      v_breakdown := v_breakdown || jsonb_build_object(rule.rule_key, rule.score);
    END IF;
  END LOOP;

  SELECT score INTO v_admin_bonus FROM public.quality_admin_bonus WHERE user_id = p_user_id;
  IF v_admin_bonus IS NOT NULL THEN
    v_score := v_score + v_admin_bonus;
    v_breakdown := v_breakdown || jsonb_build_object('admin_bonus', v_admin_bonus);
  END IF;

  RETURN jsonb_build_object('total_score', v_score, 'breakdown', v_breakdown, 'eligible', true);
END;
$$;
REVOKE ALL ON FUNCTION public._calculate_quality_score_internal(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- step 4 (取消): 新 overload _calculate_quality_score_internal(uuid, text) を DROP
DROP FUNCTION IF EXISTS public._calculate_quality_score_internal(uuid, text);

-- =============================================================================
-- step 1〜3 の逆順: quality_score_snapshots スキーマを旧状態に戻す
--   - game_title 列 DROP 前に pokepoke 行を DELETE する (旧スキーマには存在しなかった)。
-- =============================================================================

-- pokepoke 側 snapshot を削除 (旧スキーマ復元のため)
DELETE FROM public.quality_score_snapshots WHERE game_title <> 'dm';

-- step 3 の逆順: 旧 (user_id) UNIQUE を ADD CONSTRAINT で復元
ALTER TABLE public.quality_score_snapshots
  ADD CONSTRAINT quality_score_snapshots_user_id_key UNIQUE (user_id);

-- step 2 の逆順: 新 (user_id, game_title) UNIQUE を DROP
ALTER TABLE public.quality_score_snapshots
  DROP CONSTRAINT IF EXISTS quality_score_snapshots_user_game_unique;

-- step 1 の逆順: game_title 列 DROP
ALTER TABLE public.quality_score_snapshots
  DROP COLUMN IF EXISTS game_title;
