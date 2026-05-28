-- Rollback for 20260527000003_c2_detection_game_scope.sql (Plan C C-2)
-- 新 overload (p_params jsonb, p_game_title text) を DROP し、
-- COMMENT を旧 overload から削除する。旧 overload (p_params jsonb のみ) は
-- 20260509000001 で作成されており、本 migration では touch していないのでそのまま残る。
-- C-3 rollback と組み合わせる場合は、先に C-3 を rollback してから本ファイルを実行すること
-- (新 overload を呼ぶ runner が残っていると新 overload DROP で関数依存エラーになる)。

DROP FUNCTION IF EXISTS public.detect_extreme_winrate(jsonb, text);
DROP FUNCTION IF EXISTS public.detect_rapid_input(jsonb, text);
DROP FUNCTION IF EXISTS public.detect_repetitive_pattern(jsonb, text);

COMMENT ON FUNCTION public.detect_extreme_winrate(jsonb) IS NULL;
COMMENT ON FUNCTION public.detect_rapid_input(jsonb) IS NULL;
COMMENT ON FUNCTION public.detect_repetitive_pattern(jsonb) IS NULL;
