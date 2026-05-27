-- Rollback for 20260527000004_c3_run_detection_scan_internal_game_loop.sql (Plan C C-3)
-- 旧定義 (20260509000001:645) に戻す: game 別ループを撤去し、detect_* 旧 overload を呼ぶ状態へ。
-- 注意: 本 rollback 適用後は detection_alerts.game_title が再び default 'dm' に張り付く。

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
BEGIN
  FOR rule IN SELECT * FROM public.detection_rules WHERE is_enabled = true LOOP
    CASE rule.rule_key
      WHEN 'extreme_winrate' THEN
        INSERT INTO public.detection_alerts (user_id, rule_key, details)
        SELECT * FROM public.detect_extreme_winrate(rule.params);
      WHEN 'rapid_input' THEN
        INSERT INTO public.detection_alerts (user_id, rule_key, details)
        SELECT * FROM public.detect_rapid_input(rule.params);
      WHEN 'repetitive_pattern' THEN
        INSERT INTO public.detection_alerts (user_id, rule_key, details)
        SELECT * FROM public.detect_repetitive_pattern(rule.params);
    END CASE;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    total_alerts := total_alerts + v_row_count;
  END LOOP;
  RETURN total_alerts;
END;
$$;
REVOKE ALL ON FUNCTION public._run_detection_scan_internal()
  FROM PUBLIC, anon, authenticated, service_role;
