-- Plan C C-3: _run_detection_scan_internal の game × rule 二重ループ化
--
-- 背景:
--   現行 _run_detection_scan_internal は game 別ループなし。
--   INSERT INTO public.detection_alerts (user_id, rule_key, details) で game_title を
--   省略していたため、default 'dm' に固定されていた。
--   → ポケポケ専用 user の alert も dm として記録される、
--      dm/pokepoke 両方プレイするユーザーは合算で擬陽性が増える。
--
-- 設計 (RD-C1 / RD-C2 / RD-C8):
--   - v_game_titles を ARRAY['dm', 'pokepoke'] でハードコード。
--     新ゲーム追加時は src/lib/games/index.ts の GAME_SLUGS と同期して migration で更新必要
--     (Phase 2 で public.games マスタテーブル化 + 動的取得を検討、§10.B 参照)。
--   - C-2 で追加した detect_* の 2 引数 overload (p_params, p_game_title) のみを呼ぶ。
--   - INSERT は d.rule_key 経由で統一 (Codex 第 2 回確定、v_rule.rule_key 二重供給は撤回)。
--   - dedup は detect_* 内の NOT EXISTS (da.game_title = p_game_title AND da.is_resolved = false)
--     に集約済 (RD-C1)、runner 側は orchestration のみ。
--   - INSERT に game_title 列を明示し、default 'dm' 固定問題を解消する。
--
-- 既存規約準拠:
--   SECURITY DEFINER + SET search_path = '' + public. 修飾
--   REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role
--   (runner は所有者ロール経由でしか呼ばないため EXECUTE 全閉鎖、20260509000001:674 と同じ)

CREATE OR REPLACE FUNCTION public._run_detection_scan_internal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_alerts integer := 0;
  v_row_count integer;
  rule record;
  v_game_title text;
  -- Plan C RD-C2: src/lib/games/index.ts の GAME_SLUGS と同期が必要。
  -- 新ゲーム追加時はこの配列も migration で更新すること。
  -- Phase 2 で public.games マスタテーブル化 + 動的取得を検討予定 (§10.B)。
  v_game_titles text[] := ARRAY['dm', 'pokepoke'];
BEGIN
  FOR rule IN SELECT * FROM public.detection_rules WHERE is_enabled = true LOOP
    FOREACH v_game_title IN ARRAY v_game_titles
    LOOP
      CASE rule.rule_key
        WHEN 'extreme_winrate' THEN
          INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details)
          SELECT d.user_id, d.rule_key, v_game_title, d.details
          FROM public.detect_extreme_winrate(rule.params, v_game_title) d;
        WHEN 'rapid_input' THEN
          INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details)
          SELECT d.user_id, d.rule_key, v_game_title, d.details
          FROM public.detect_rapid_input(rule.params, v_game_title) d;
        WHEN 'repetitive_pattern' THEN
          INSERT INTO public.detection_alerts (user_id, rule_key, game_title, details)
          SELECT d.user_id, d.rule_key, v_game_title, d.details
          FROM public.detect_repetitive_pattern(rule.params, v_game_title) d;
        ELSE
          -- 未知の rule_key: 何もしない (将来 detection rule 追加時の安全弁)
          NULL;
      END CASE;
      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      total_alerts := total_alerts + v_row_count;
    END LOOP;
  END LOOP;
  RETURN total_alerts;
END;
$$;
REVOKE ALL ON FUNCTION public._run_detection_scan_internal()
  FROM PUBLIC, anon, authenticated, service_role;
